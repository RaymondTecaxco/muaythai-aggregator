// Per-stage timing for the pipeline. Wrap a step in time('label', fn) and
// printReport() shows calls, total, average and max for each label.

const { performance } = require('node:perf_hooks');

const stats = new Map();
const counters = new Map();

function record(label, ms) {
    const s = stats.get(label) || { count: 0, totalMs: 0, maxMs: 0 };
    s.count += 1;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    stats.set(label, s);
}

// records the duration even if fn throws
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
