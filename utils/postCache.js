// utils/postCache.js
// Remembers what Gemini said about each Instagram post, so we never pay
// (in time or free-tier quota) to ask about the same post twice.
//
// The cache is a plain JSON file on disk: { "<key>": { result, cachedAt } }.
// Keys come in two flavours:
//   "post:<shortCode>"   - Instagram's unique ID for a post. Checked FIRST, before
//                          we even download the image.
//   "content:<sha256>"   - a fingerprint (hash) of exactly what we'd show Gemini
//                          (caption + image bytes). Catches the same flyer or
//                          caption re-posted under a different post / account.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { addCount } = require('./timer');

// POST_CACHE_FILE lets tests point at a throwaway file instead of the real cache.
const CACHE_FILE = process.env.POST_CACHE_FILE || path.join(__dirname, '..', '.cache', 'gemini-results.json');

let store = null;           // the loaded JSON object; null until first use
const inFlight = new Map(); // key -> Promise for Gemini calls that are running right now

// Lazy loading: read the file the first time someone needs it, not at require() time.
function load() {
    if (store) return store;
    try {
        store = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch {
        store = {}; // no file yet (first run) or unreadable -> start empty
    }
    return store;
}

// SHA-256 turns any input (text or bytes) into a 64-character fingerprint.
// Same input -> always the same fingerprint; change one byte -> a totally different one.
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function get(key) {
    const entry = load()[key];
    return entry ? entry.result : undefined;
}

function set(key, result) {
    load()[key] = { result, cachedAt: new Date().toISOString() };
}

// Return the cached result for `key`, or run `compute()` to produce it and save it.
// If two posts with identical content are being processed at the same moment,
// they share ONE compute() call instead of both calling Gemini ("promise memoization").
async function getOrCompute(key, compute) {
    const cached = get(key);
    if (cached !== undefined) {
        addCount('cache.hit (same content)');
        return cached;
    }
    if (inFlight.has(key)) {
        addCount('cache.hit (shared in-flight call)');
        return inFlight.get(key);
    }

    const promise = compute().then(result => {
        set(key, result); // only reached on success, so failures are never cached
        return result;
    });
    inFlight.set(key, promise);
    try {
        return await promise;
    } finally {
        inFlight.delete(key);
    }
}

// Write everything back to disk once, at the end of the run.
function save() {
    if (!store) return;
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2));
}

module.exports = { sha256, get, set, getOrCompute, save };
