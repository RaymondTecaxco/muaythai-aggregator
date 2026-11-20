// Normalizes scraped event fields so the same event always produces the same
// record. Typical input: "Madison SQUARE GARDEN", "The Bronx", "6PM", "TBD",
// "ThreePillarPromotions", "www.ticketmaster.com", "(December 12.)".

const { parseEventDate } = require('./filterEvents');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

// "(December 12.)" -> "December 12"
function cleanText(value) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/@/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.,;:\-–—|]+|[\s.,;:\-–—|]+$/g, '')
        .trim();
}

// Treated as missing so they don't end up stored as if they were real values.
const PLACEHOLDERS = /^(tbd|tba|n\/?a|none|null|unknown|not (stated|specified|provided)|location tbd|venue tbd|time tbd|upcoming event|next event|new event|event)$/i;

function isPlaceholder(value) {
    return value === '' || PLACEHOLDERS.test(value);
}

function cleanField(value) {
    const text = cleanText(value);
    return isPlaceholder(text) ? '' : text;
}

const ACRONYMS = new Set(['NY', 'NJ', 'CT', 'PA', 'NYC', 'LIC', 'USA', 'US', 'MMA', 'WBC',
    'IKF', 'ISKA', 'WKA', 'PRO', 'AM', 'PM', 'UFC', 'RFC', 'MSG']);
const SMALL_WORDS = new Set(['of', 'at', 'the', 'in', 'and', 'vs', 'on', 'for', 'a', 'an', 'to']);
// for show numbers like "Warriors Series IV"
const ROMAN = /^(?=[MDCLXVI])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

// Only rewrites ALL-CAPS words. Mixed case like "McDonald" is probably
// intentional, so it's left alone.
function smartTitleCase(text) {
    return text.split(' ').map((word, i) => {
        const letters = word.replace(/[^A-Za-z]/g, '');
        if (!letters) return word;                              // "81", "10/23", "&"
        if (/\d/.test(word)) return word;                       // "6PM", "24TH", "3KINGS"
        const bare = letters.toUpperCase();
        if (ACRONYMS.has(bare) || ROMAN.test(bare)) return word.toUpperCase();
        if (letters !== bare) {
            return i > 0 && SMALL_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : word;
        }
        const lower = word.toLowerCase();
        if (i > 0 && SMALL_WORDS.has(lower)) return lower;
        return lower.replace(/[a-z]/, c => c.toUpperCase());
    }).join(' ');
}

// Keys are in comparisonKey() form.
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

// Lowercase, alphanumerics only, for matching values that differ only in
// case or punctuation.
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

// Flyers can name several promoters: "ThreePillarPromotions and rfc.promotions"
// -> "Three Pillar Promotions & RFC Promotions"
function normalizePromoter(value) {
    const raw = cleanField(value).replace(/\.(?=[a-z])/gi, ' '); // handles like rfc.promotions
    if (!raw) return '';
    return raw.split(/\s*(?:&|\band\b|,|\/|\+)\s*/i)
        .map(part => cleanField(part))
        .filter(Boolean)
        .map(part => PROMOTER_ALIASES[comparisonKey(part)] || smartTitleCase(part))
        .filter((part, i, all) => all.indexOf(part) === i)
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

// Bare homepages ("www.ticketmaster.com") are dropped; they don't point to
// the event.
function normalizeUrl(value) {
    let text = cleanField(value);
    if (!text) return '';
    if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
    try {
        const url = new URL(text);
        if (!url.hostname.includes('.')) return '';
        if (url.pathname === '/' && !url.search) return '';
        return url.toString();
    } catch {
        return '';
    }
}

function formatDate(date) {
    return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function toIsoDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "Event Name - Venue, City, ST (Month D, YYYY, H:MM PM)", skipping missing parts
function buildDetails({ eventName, promotion, venue, city, state, date, time }) {
    const name = eventName || `${promotion} Event`;
    const place = [venue, city, state].filter(Boolean)
        // avoid "Bronx, Bronx"
        .filter((part, i, all) => i === 0 || comparisonKey(part) !== comparisonKey(all[i - 1]))
        .join(', ');
    const when = [date ? formatDate(date) : '', time].filter(Boolean).join(', ');
    return `${name}${place ? ` - ${place}` : ''}${when ? ` (${when})` : ''}`;
}

// Gemini's answer for one Instagram post -> event record.
// defaultPromotion is used when the flyer doesn't name a promoter.
function cleanInstagramEvent(ai, { defaultPromotion, post, today = new Date() }) {
    const promoter = normalizePromoter(ai.promoter);
    const promotion = promoter || defaultPromotion;
    const date = parseEventDate(cleanText(ai.date), today);

    let eventName = smartTitleCase(cleanField(ai.eventName));
    // the promoter's name on its own isn't an event name
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
        sourceType: post.type,             // Image / Sidecar (flyer) or Video (caption only)
        sourceUrl: post.url,
    };
    record.details = buildDetails({ ...record, date });
    return record;
}

// "2026-12-05T14:30:00-05:00" -> date + "2:30 PM". Parsed from the text on
// purpose: new Date() would shift it into the machine's timezone, so a 2:30 PM
// show could come out as 7:30 PM on a UTC server.
function splitIsoDateTime(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(cleanText(value));
    if (!m) return { date: null, time: '' };
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (m[4] === undefined) return { date, time: '' };
    const hour24 = Number(m[4]);
    const time = `${hour24 % 12 || 12}:${m[5]} ${hour24 < 12 ? 'AM' : 'PM'}`;
    return { date, time };
}

// schema.org Event (from an Eventbrite page's JSON-LD) -> event record.
// The fields are already labeled, so no Gemini call is needed here.
function cleanListingEvent(listing, { defaultPromotion, source = 'Eventbrite' }) {
    const place = listing.location || {};
    const address = place.address || {};
    const organizer = normalizePromoter(listing.organizer?.name);
    const { date, time } = splitIsoDateTime(listing.startDate);
    const url = normalizeUrl(listing.url);

    const record = {
        promotion: defaultPromotion || organizer,
        promoterFromFlyer: Boolean(organizer),
        eventName: smartTitleCase(cleanField(listing.name)),
        venue: smartTitleCase(cleanField(place.name)),
        city: normalizeCity(address.addressLocality),
        state: normalizeState(address.addressRegion),
        time,
        event_date: date ? toIsoDate(date) : null,
        url,
        hasTicketLink: Boolean(url),
        sourceType: source,
        sourceUrl: url,
    };
    record.details = buildDetails({ ...record, date });
    return record;
}

// Website scrapers only give one line of text, so this tidies it without
// splitting it into fields. raw.url is the ticket link ('' or 'N/A' if none);
// raw.pageUrl is the fallback link.
function cleanWebEvent(raw, { today = new Date() } = {}) {
    const details = smartTitleCase(cleanText(raw.details));
    const date = parseEventDate(details, today);
    // Has to be a real link; otherwise 'N/A' could win over a real ticket
    // link when records merge.
    const ticketUrl = normalizeUrl(raw.url);
    const link = ticketUrl || cleanField(raw.pageUrl) || cleanField(raw.url);
    return {
        promotion: normalizePromoter(raw.promotion) || cleanText(raw.promotion),
        promoterFromFlyer: true,
        eventName: '', venue: '', city: '', state: '', time: '',
        event_date: date ? toIsoDate(date) : null,
        url: link,
        hasTicketLink: Boolean(ticketUrl),
        sourceType: 'Website',
        sourceUrl: cleanField(raw.pageUrl) || link,
        details,
    };
}

module.exports = {
    cleanText, cleanField, isPlaceholder, smartTitleCase, comparisonKey,
    normalizeState, normalizeCity, normalizePromoter, normalizeTime, normalizeUrl,
    buildDetails, toIsoDate, cleanInstagramEvent, cleanListingEvent, cleanWebEvent,
};
