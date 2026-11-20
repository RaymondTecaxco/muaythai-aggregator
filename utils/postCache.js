// Caches Gemini results on disk so a post is only ever sent once.
//
// Two kinds of keys:
//   post:<shortCode>  checked first, before downloading the image
//   content:<sha256>  hash of caption + image, catches the same flyer
//                     reposted by another account

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { addCount } = require('./timer');

// tests set POST_CACHE_FILE to a temp file
const CACHE_FILE = process.env.POST_CACHE_FILE || path.join(__dirname, '..', '.cache', 'gemini-results.json');

let store = null;
const inFlight = new Map();

function load() {
    if (store) return store;
    try {
        store = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch {
        store = {}; // first run, or the file is unreadable
    }
    return store;
}

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

// Concurrent requests for the same key share one in-flight call.
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
        set(key, result); // failures aren't cached
        return result;
    });
    inFlight.set(key, promise);
    try {
        return await promise;
    } finally {
        inFlight.delete(key);
    }
}

// called once at the end of a run
function save() {
    if (!store) return;
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2));
}

module.exports = { sha256, get, set, getOrCompute, save };
