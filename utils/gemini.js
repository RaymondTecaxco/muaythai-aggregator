// Shared Gemini client for the Instagram scrapers: one rate limiter, retry
// policy and model fallback for all of them.
//
// Optional .env settings:
//   GEMINI_MODEL           default gemini-3.5-flash-lite
//   GEMINI_FALLBACK_MODEL  default gemini-3.8-flash; set empty to disable
//   GEMINI_RPM             default 4
//   GEMINI_TIMEOUT_MS      default 30000

const { setTimeout: sleep } = require('node:timers/promises');
const { GoogleGenAI } = require('@google/genai');
const { time, addCount } = require('./timer');
const { sha256 } = require('./postCache');

// flash-lite as primary because 3.8-flash kept returning 503s in testing.
// 3.8-flash has a separate free quota, so it's still useful as a fallback.
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-3.8-flash';
const RPM = Number(process.env.GEMINI_RPM) || 4;
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 30000;
const MAX_ATTEMPTS = 3;              // per post, per model
const FAILURES_BEFORE_SWITCHING = 5; // consecutive failures before a model counts as down

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Separate fields instead of one sentence so formatting happens in
// cleanEvents.js, not in the model. Unknown values come back as "" rather
// than a guess.
const text = description => ({ type: 'string', description });
const EVENT_SCHEMA = {
    type: 'object',
    properties: {
        isEvent: {
            type: 'boolean',
            description: 'true only if the post announces or promotes a specific upcoming combat sports event',
        },
        eventName: text('Official event name exactly as written, e.g. "Muay Thai Madness 25" or "Warriors Series IV". Empty if no event name is written. Never invent a name from a fighter\'s name.'),
        promoter: text('Promotion company running the event, e.g. from "Promoted by ...". Empty if not stated.'),
        date: text('Event date as written, including the year if shown, e.g. "December 12 2026" or "Jan 23". Empty if unknown.'),
        time: text('Start time as written, e.g. "7PM". Empty if unknown.'),
        venue: text('Venue or building name only, e.g. "Madison Square Garden". Empty if unknown.'),
        city: text('City or borough, e.g. "Bronx". Empty if unknown.'),
        state: text('US state, e.g. "NY". Empty if unknown.'),
        ticketUrl: text('Ticket or event web link written on the flyer or caption. Empty if none.'),
    },
    required: ['isEvent', 'eventName', 'promoter', 'date', 'time', 'venue', 'city', 'state', 'ticketUrl'],
};

const models = [...new Set([PRIMARY_MODEL, FALLBACK_MODEL].filter(Boolean))]
    .map(name => ({ name, down: false, consecutiveFailures: 0 }));

// Aborted once every model is down, which cancels any queued sleeps.
const allModelsDown = new AbortController();

function currentModel() {
    return models.find(m => !m.down);
}

function markDown(model, reason) {
    if (model.down) return;
    model.down = true;
    const next = currentModel();
    if (next) {
        console.warn(`     ! ${model.name} is down (${reason}). Switching to ${next.name}.`);
    } else {
        console.warn(`     ! ${model.name} is down (${reason}). No models left; skipping remaining AI calls this run.`);
        allModelsDown.abort(new Error(`Gemini skipped: every model is down (last: ${reason})`));
    }
}

// Spaces call start times at least 60 / RPM seconds apart.
const MIN_GAP_MS = 60000 / RPM;
let nextFreeSlot = 0;

async function waitForSlot() {
    const now = Date.now();
    const myTurn = Math.max(now, nextFreeSlot);
    nextFreeSlot = myTurn + MIN_GAP_MS;
    if (myTurn > now) {
        await time('throttle.wait', () => sleep(myTurn - now, undefined, { signal: allModelsDown.signal }));
    }
}

// ApiError.message holds Google's JSON error body as a string.
function isDailyQuotaError(err) {
    return err.status === 429 && /per ?day/i.test(err.message);
}

function isModelMissing(err) {
    return err.status === 404; // e.g. a retired model name
}

function isRetryable(err) {
    return err.status === 429
        || err.status >= 500
        || err.name === 'AbortError' || err.name === 'TimeoutError';
}

// e.g. "retryDelay":"17s" in a 429 response
function suggestedRetryMs(err) {
    const match = /"retryDelay":\s*"([\d.]+)s"/.exec(err.message || '');
    return match ? parseFloat(match[1]) * 1000 : null;
}

// Returns the parsed JSON answer.
async function askGemini(contents) {
    for (let attempt = 1; ; attempt++) {
        await waitForSlot();
        const model = currentModel();
        if (!model) throw allModelsDown.signal.reason;

        try {
            const response = await time('gemini.call', () => ai.models.generateContent({
                model: model.name,
                contents,
                config: {
                    responseMimeType: 'application/json',
                    responseJsonSchema: EVENT_SCHEMA,
                    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
                },
            }));
            if (!response.text) throw new Error(`${model.name} returned an empty answer`);
            const data = await time('parse.json', async () => JSON.parse(response.text));
            model.consecutiveFailures = 0;
            addCount(`gemini.answered by ${model.name}`);
            return data;
        } catch (err) {
            addCount('gemini.failed attempts');

            // no point retrying these on the same model today
            if (isDailyQuotaError(err) || isModelMissing(err)) {
                markDown(model, isDailyQuotaError(err) ? 'daily free-tier quota used up' : 'model not found');
                attempt = 0;
                continue;
            }
            if (!isRetryable(err)) throw err;

            if (++model.consecutiveFailures >= FAILURES_BEFORE_SWITCHING) {
                markDown(model, `${model.consecutiveFailures} calls in a row failed (${err.status || 'timeout'})`);
                attempt = 0;
                continue;
            }
            if (attempt >= MAX_ATTEMPTS) throw err;

            // Google's suggested delay if given, else 2 s / 4 s plus jitter; max 60 s
            const backoffMs = Math.min(60000, suggestedRetryMs(err) ?? (2 ** attempt * 1000 + Math.random() * 1000));
            console.log(`     - ${model.name} ${err.status || 'timeout'}; retry ${attempt}/${MAX_ATTEMPTS - 1} in ${(backoffMs / 1000).toFixed(1)} s`);
            addCount('gemini.retries');
            await time('retry.backoff', () => sleep(backoffMs, undefined, { signal: allModelsDown.signal }));
        }
    }
}

// Returns the image as a Gemini part plus its hash for the cache.
async function downloadImage(imageUrl) {
    const { buffer, mimeType } = await time('image.download', async () => {
        const response = await fetch(imageUrl);
        return {
            buffer: Buffer.from(await response.arrayBuffer()),
            // some Instagram images are HEIC, so don't assume JPEG
            mimeType: (response.headers.get('content-type') || 'image/jpeg').split(';')[0],
        };
    });
    addCount('image.bytes', buffer.length);
    addCount('image.count');
    return {
        hash: sha256(buffer),
        part: { inlineData: { data: buffer.toString('base64'), mimeType } },
    };
}

module.exports = { askGemini, downloadImage };
