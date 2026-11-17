// utils/timer.js
// A tiny "stopwatch registry" used to measure where the pipeline spends its time.
//
// How it works:
//   - time(label, fn) runs fn, measures how long it took, and adds that duration
//     to a running total stored under `label` (e.g. "gemini.call").
//   - addCount(label, n) keeps a plain counter (e.g. bytes of images downloaded).
//   - printReport() prints one table with every label: how many times it ran,
//     total seconds, average, and the slowest single run.

// performance.now() is a high-resolution clock meant for measuring durations.
// Unlike Date.now(), it never jumps if the computer's clock is adjusted.
const { performance } = require('node:perf_hooks');

// A Map is a key -> value store. Key = stage label, value = running stats.
const stats = new Map();
const counters = new Map();

function record(label, ms) {
    const s = stats.get(label) || { count: 0, totalMs: 0, maxMs: 0 };
    s.count += 1;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    stats.set(label, s);
}

// `fn` is an async function (it returns a Promise). We await it so we measure
// the full time until its work is really finished, not just until it starts.
// `try...finally` makes sure we record the time even if fn throws an error.
async function time(label, fn) {
    const start = performance.now();
    try {
        return await fn();
    } finally {
        record(label, performance.now() - start);
    }
}

function addCount(label, n = 1) {
    counters.set(label, (counters.get(label) || 0) + n);
}

function printReport(wallClockMs) {
    const rows = {};
    for (const [label, s] of stats) {
        rows[label] = {
            calls: s.count,
            'total (s)': +(s.totalMs / 1000).toFixed(2),
            'avg (s)': +(s.totalMs / s.count / 1000).toFixed(2),
            'max (s)': +(s.maxMs / 1000).toFixed(2),
            '% of run': +((s.totalMs / wallClockMs) * 100).toFixed(1),
        };
    }
    console.log('\n=== TIMING REPORT ===');
    console.log(`Wall-clock total: ${(wallClockMs / 1000).toFixed(1)} s`);
    console.log('(Rows overlap: stages inside a "scraper:*" row are counted there too, and work that runs in');
    console.log(' parallel is added up per call. So "total" can exceed the wall clock and % can pass 100.)');
    console.table(rows);
    if (counters.size) {
        console.table(Object.fromEntries([...counters].map(([k, v]) => [k, { value: v }])));
    }
}

module.exports = { time, addCount, printReport };
