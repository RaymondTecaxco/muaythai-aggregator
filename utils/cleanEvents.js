// utils/cleanEvents.js
// DATA CLEANING: turn messy, inconsistently formatted event data into one
// standard shape, so the same real-world event always produces the same text.
//
// Gemini (and promoters' websites) give us values like:
//   "Madison SQUARE GARDEN", "The Bronx", "New York", "6PM", "TBD",
//   "ThreePillarPromotions", "www.ticketmaster.com", "(December 12.)"
// Each helper below fixes ONE kind of mess. Small, single-purpose functions are
// easy to test (see tests/cleaning.test.js) and easy to extend when a new
// messy value shows up.

const { parseEventDate } = require('./filterEvents');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------------------
// 1. Basic text hygiene
// ---------------------------------------------------------------------------

// Collapse runs of spaces/newlines, drop stray "@" from Instagram handles,
// and trim punctuation left dangling at either end ("(December 12.)" -> "December 12").
function cleanText(value) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/@/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.,;:\-–—|]+|[\s.,;:\-–—|]+$/g, '')
        .trim();
}

// Words that mean "we don't know". Storing them would look like real data,
// so we turn them into an empty string (a missing value) instead.
const PLACEHOLDERS = /^(tbd|tba|n\/?a|none|null|unknown|not (stated|specified|provided)|location tbd|venue tbd|time tbd|upcoming event|next event|new event|event)$/i;

function isPlaceholder(value) {
    return value === '' || PLACEHOLDERS.test(value);
}

// cleanText + placeholder check in one step: returns '' for "no real value".
function cleanField(value) {
    const text = cleanText(value);
    return isPlaceholder(text) ? '' : text;
}

// ---------------------------------------------------------------------------
// 2. Consistent capitalisation
// ---------------------------------------------------------------------------

// Abbreviations that must stay in capitals.
const ACRONYMS = new Set(['NY', 'NJ', 'CT', 'PA', 'NYC', 'LIC', 'USA', 'US', 'MMA', 'WBC',
    'IKF', 'ISKA', 'WKA', 'PRO', 'AM', 'PM', 'UFC', 'RFC', 'MSG']);
const SMALL_WORDS = new Set(['of', 'at', 'the', 'in', 'and', 'vs', 'on', 'for', 'a', 'an', 'to']);
// Roman numerals such as IV, XII ("Warriors Series IV").
const ROMAN = /^(?=[MDCLXVI])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

// Only words written ENTIRELY in capitals are rewritten ("SQUARE" -> "Square").
// Words that already have mixed case ("McDonald", "iPhone") are left alone,
// because their capitalisation is probably deliberate.
function smartTitleCase(text) {
    return text.split(' ').map((word, i) => {
        const letters = word.replace(/[^A-Za-z]/g, '');
        if (!letters) return word;                              // "81", "10/23", "&"
        if (/\d/.test(word)) return word;                       // "6PM", "24TH", "3KINGS"
        const bare = letters.toUpperCase();
        if (ACRONYMS.has(bare) || ROMAN.test(bare)) return word.toUpperCase();
        if (letters !== bare) {                                 // not ALL CAPS
            return i > 0 && SMALL_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : word;
        }
        const lower = word.toLowerCase();
        if (i > 0 && SMALL_WORDS.has(lower)) return lower;
        // Capitalise the first letter (keeps punctuation like "(" or "'" in place).
        return lower.replace(/[a-z]/, c => c.toUpperCase());
    }).join(' ');
}

// ---------------------------------------------------------------------------
// 3. Standard values for places, promoters and times
// ---------------------------------------------------------------------------

// "Lookup tables" (also called mapping or alias tables): many spellings -> one standard value.
// Keys are written in "comparison form" (see comparisonKey below).
const STATE_CODES = {
    'new york': 'NY', 'ny': 'NY', 'new jersey': 'NJ', 'nj': 'NJ',
    'connecticut': 'CT', 'ct': 'CT', 'pennsylvania': 'PA', 'pa': 'PA',
};
const CITY_ALIASES = {
    'the bronx': 'Bronx', 'bronx': 'Bronx', 'nyc': 'New York', 'new york city': 'New York',
    'manhattan': 'New York', 'lic': 'Long Island City', 'brooklyn': 'Brooklyn',
};
const PROMOTER_ALIASES = {
    'threepillarpromotions': 'Three Pillar Promotions', 'three pillar promotions': 'Three Pillar Promotions',
    'three pillar': 'Three Pillar Promotions', '3 pillar promotions': 'Three Pillar Promotions',
    '3 kings': '3 Kings Promotions', '3 kings promotions': '3 Kings Promotions',
    '3kings promotions': '3 Kings Promotions', 'three kings promotions': '3 Kings Promotions',
    'rfc promotions': 'RFC Promotions',
    'freedom fighter promotions': 'Freedom Fighter Promotions', 'freedom fighters': 'Freedom Fighter Promotions',
};

// "Comparison form": lowercase, letters/digits/spaces only. Two values that
// differ only in capitals or punctuation ("Madison SQUARE GARDEN!" vs
// "madison square garden") get the same comparison form.
function comparisonKey(value) {
    return cleanText(value).toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeState(value) {
    const key = comparisonKey(value);
    return STATE_CODES[key] || (key.length === 2 ? key.toUpperCase() : smartTitleCase(cleanField(value)));
}

function normalizeCity(value) {
    const city = cleanField(value);
    return CITY_ALIASES[comparisonKey(city)] || smartTitleCase(city);
}

// A flyer may name several promoters ("ThreePillarPromotions and rfc.promotions").
// Split them, standardise each one, and join them back with " & ".
function normalizePromoter(value) {
    const raw = cleanField(value).replace(/\.(?=[a-z])/gi, ' '); // "rfc.promotions" -> "rfc promotions"
    if (!raw) return '';
    return raw.split(/\s*(?:&|\band\b|,|\/|\+)\s*/i)
        .map(part => cleanField(part))
        .filter(Boolean)
        .map(part => PROMOTER_ALIASES[comparisonKey(part)] || smartTitleCase(part))
        .filter((part, i, all) => all.indexOf(part) === i) // drop repeats
        .join(' & ');
}

// "6PM", "6 pm", "6:00p.m.", "Doors 5:30PM" -> "6:00 PM" / "5:30 PM".
function normalizeTime(value) {
    const match = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b/i.exec(cleanText(value));
    if (!match) return '';
    const hour = Number(match[1]);
    if (hour < 1 || hour > 12) return '';
    return `${hour}:${match[2] || '00'} ${match[3].toUpperCase()}M`;
}

// Keep a link only if it points at a specific page. A bare homepage such as
// "www.ticketmaster.com" doesn't help a reader find THIS event.
function normalizeUrl(value) {
    let text = cleanField(value);
    if (!text) return '';
    if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
    try {
        const url = new URL(text); // throws if the text isn't a valid web address
        if (!url.hostname.includes('.')) return '';
        if (url.pathname === '/' && !url.search) return '';
        return url.toString();
    } catch {
        return '';
    }
}

// ---------------------------------------------------------------------------
// 4. Building the final, consistent "details" text
// ---------------------------------------------------------------------------

function formatDate(date) {
    return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function toIsoDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// One template for every event:
//   "Event Name - Venue, City, ST (Month D, YYYY, H:MM PM)"
// Parts that are missing are simply left out, never written as "TBD".
function buildDetails({ eventName, promotion, venue, city, state, date, time }) {
    const name = eventName || `${promotion} Event`;
    const place = [venue, city, state].filter(Boolean)
        // drop a part that just repeats the one before it ("New York, NY" stays,
        // but "Bronx, Bronx" doesn't happen)
        .filter((part, i, all) => i === 0 || comparisonKey(part) !== comparisonKey(all[i - 1]))
        .join(', ');
    const when = [date ? formatDate(date) : '', time].filter(Boolean).join(', ');
    return `${name}${place ? ` - ${place}` : ''}${when ? ` (${when})` : ''}`;
}

// ---------------------------------------------------------------------------
// 5. Entry points used by the scrapers
// ---------------------------------------------------------------------------

// Gemini's structured answer for one Instagram post -> one clean event record.
//   defaultPromotion: label to use when the flyer doesn't name a promoter
//   post:             the Instagram post (for its link, type and caption)
function cleanInstagramEvent(ai, { defaultPromotion, post, today = new Date() }) {
    const promoter = normalizePromoter(ai.promoter);
    const promotion = promoter || defaultPromotion;
    const date = parseEventDate(cleanText(ai.date), today);

    let eventName = smartTitleCase(cleanField(ai.eventName));
    // A name that's only the promoter or a generic phrase isn't a real event name.
    if (comparisonKey(eventName) === comparisonKey(promotion)) eventName = '';

    const record = {
        promotion,
        promoterFromFlyer: Boolean(promoter),
        eventName,
        venue: smartTitleCase(cleanField(ai.venue)),
        city: normalizeCity(ai.city),
        state: normalizeState(ai.state),
        time: normalizeTime(ai.time),
        event_date: date ? toIsoDate(date) : null,
        url: normalizeUrl(ai.ticketUrl) || post.url,
        hasTicketLink: Boolean(normalizeUrl(ai.ticketUrl)),
        sourceType: post.type,             // "Image" / "Sidecar" flyer, or "Video" caption
        sourceUrl: post.url,
    };
    record.details = buildDetails({ ...record, date });
    return record;
}

// Website scrapers give us one line of text; we can only tidy it, not split it.
function cleanWebEvent(raw, { today = new Date() } = {}) {
    const details = smartTitleCase(cleanText(raw.details));
    const date = parseEventDate(details, today);
    return {
        promotion: normalizePromoter(raw.promotion) || cleanText(raw.promotion),
        promoterFromFlyer: true,
        eventName: '', venue: '', city: '', state: '', time: '',
        event_date: date ? toIsoDate(date) : null,
        url: raw.url,
        hasTicketLink: true,
        sourceType: 'Website',
        sourceUrl: raw.url,
        details,
    };
}

module.exports = {
    cleanText, cleanField, isPlaceholder, smartTitleCase, comparisonKey,
    normalizeState, normalizeCity, normalizePromoter, normalizeTime, normalizeUrl,
    buildDetails, toIsoDate, cleanInstagramEvent, cleanWebEvent,
};
