// utils/gemini.js
// One shared "front door" for every Gemini call in the project.
// Both Instagram scrapers use it, so they share one rate limiter, one set of
// retry rules, and one model-fallback chain instead of each guessing on their own.
//
// Settings (all optional, put them in .env):
//   GEMINI_MODEL           main model                    (default: gemini-3.5-flash-lite)
//   GEMINI_FALLBACK_MODEL  used when the main one is down (default: gemini-3.8-flash;
//                          set it to an empty value to turn the fallback off)
//   GEMINI_RPM             max requests per minute       (default: 4, the old 15-second spacing)
//   GEMINI_TIMEOUT_MS      give up on one call after     (default: 30000 = 30 s)

const { setTimeout: sleep } = require('node:timers/promises');
const { GoogleGenAI } = require('@google/genai');
const { time, addCount } = require('./timer');
const { sha256 } = require('./postCache');

// flash-lite is the main model: it answered reliably on 2026-11-16/17 while
// gemini-3.8-flash kept returning 503 "high demand". The bigger model stays as
// the fallback, since it has its own separate free quota.
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-3.8-flash';
const RPM = Number(process.env.GEMINI_RPM) || 4;
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 30000;
const MAX_ATTEMPTS = 3;              // tries per post on one model (1 try + 2 retries)
const FAILURES_BEFORE_SWITCHING = 5; // failed calls in a row on one model -> treat it as down

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ---------------------------------------------------------------------------
// Forced JSON output: Gemini must answer in exactly this shape.
// This is standard JSON Schema: "type" says what kind of value each field is,
// "required" lists the fields that must always be present, and "description"
// tells the model what to put there (it reads these like extra instructions).
// ---------------------------------------------------------------------------
// Each fact gets its own field (instead of one free-text sentence), so our code,
// not the AI, decides how the final text is formatted. See utils/cleanEvents.js.
// Every field is required; an unknown value must be an empty string "", never
// a made-up one, so missing data stays visibly missing.
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

// ---------------------------------------------------------------------------
// Model fallback chain. Each model has its own free-tier quota, so when the
// main one is overloaded or out of quota, the next one can still answer.
// ---------------------------------------------------------------------------
const models = [...new Set([PRIMARY_MODEL, FALLBACK_MODEL].filter(Boolean))]
    .map(name => ({ name, down: false, consecutiveFailures: 0 }));

// Aborted only when EVERY model is down. Aborting wakes up every sleep() that
// was given this signal, so posts waiting in the queue give up at once.
const allModelsDown = new AbortController();

function currentModel() {
    return models.find(m => !m.down); // first model that is still up, or undefined
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

// ---------------------------------------------------------------------------
// Rate limiter: hand out call "start times" at least (60 / RPM) seconds apart.
// ---------------------------------------------------------------------------
const MIN_GAP_MS = 60000 / RPM;
let nextFreeSlot = 0; // timestamp (ms) when the next call is allowed to start

async function waitForSlot() {
    const now = Date.now();
    const myTurn = Math.max(now, nextFreeSlot); // reserve the earliest free slot...
    nextFreeSlot = myTurn + MIN_GAP_MS;          // ...and push the next one back
    if (myTurn > now) {
        await time('throttle.wait', () => sleep(myTurn - now, undefined, { signal: allModelsDown.signal }));
    }
}

// ---------------------------------------------------------------------------
// Reading errors. The library throws an ApiError whose .status is the HTTP
// status code and whose .message is Google's JSON error body as text.
// ---------------------------------------------------------------------------
function isDailyQuotaError(err) {
    return err.status === 429 && /per ?day/i.test(err.message);
}

function isModelMissing(err) {
    return err.status === 404; // e.g. a model name Google has retired
}

function isRetryable(err) {
    return err.status === 429                       // too many requests this minute
        || err.status >= 500                        // Google-side trouble (503 = overloaded)
        || err.name === 'AbortError' || err.name === 'TimeoutError'; // our 30 s timeout fired
}

// Google sometimes says how long to wait, e.g. "retryDelay":"17s".
function suggestedRetryMs(err) {
    const match = /"retryDelay":\s*"([\d.]+)s"/.exec(err.message || '');
    return match ? parseFloat(match[1]) * 1000 : null;
}

// ---------------------------------------------------------------------------
// askGemini: the only function scrapers call. Returns the parsed JSON answer.
// ---------------------------------------------------------------------------
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

            // This model can't help today: move to the next one straight away.
            if (isDailyQuotaError(err) || isModelMissing(err)) {
                markDown(model, isDailyQuotaError(err) ? 'daily free-tier quota used up' : 'model not found');
                attempt = 0; // fresh set of attempts on the next model
                continue;
            }
            if (!isRetryable(err)) throw err; // e.g. an empty or unreadable answer

            if (++model.consecutiveFailures >= FAILURES_BEFORE_SWITCHING) {
                markDown(model, `${model.consecutiveFailures} calls in a row failed (${err.status || 'timeout'})`);
                attempt = 0;
                continue;
            }
            if (attempt >= MAX_ATTEMPTS) throw err;

            // Exponential backoff: wait 2 s, then 4 s (plus a little randomness, "jitter"),
            // or whatever Google suggested, capped at 60 s.
            const backoffMs = Math.min(60000, suggestedRetryMs(err) ?? (2 ** attempt * 1000 + Math.random() * 1000));
            console.log(`     - ${model.name} ${err.status || 'timeout'}; retry ${attempt}/${MAX_ATTEMPTS - 1} in ${(backoffMs / 1000).toFixed(1)} s`);
            addCount('gemini.retries');
            await time('retry.backoff', () => sleep(backoffMs, undefined, { signal: allModelsDown.signal }));
        }
    }
}

// Download an Instagram image, fingerprint it, and package it for Gemini.
async function downloadImage(imageUrl) {
    const { buffer, mimeType } = await time('image.download', async () => {
        const response = await fetch(imageUrl);
        return {
            buffer: Buffer.from(await response.arrayBuffer()),
            // Use the type the server reports (some Instagram images are HEIC, not JPEG).
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
