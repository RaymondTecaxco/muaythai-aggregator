require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { performance } = require('node:perf_hooks');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { createClient } = require('@supabase/supabase-js');
const formatAndFilterEvents = require('./utils/filterEvents');
const { cleanWebEvent, toIsoDate } = require('./utils/cleanEvents');
const { dedupeEvents, planWrites } = require('./utils/dedupeEvents');
const { time, printReport } = require('./utils/timer');
const postCache = require('./utils/postCache');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// A dry run does the whole pipeline but does NOT write to Supabase.
// Useful for testing without touching the live table the website reads.
// Turn it on with `node index.js --dry-run` (works in any terminal), or
// `npm run dry-run`. The older DRY_RUN=1 setting still works too.
// process.argv is the list of words typed on the command line:
// ['C:\\...\\node.exe', 'C:\\...\\index.js', '--dry-run']
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function runAggregator() {
    const runStart = performance.now();
    console.log(`Starting Tri-State Muay Thai Aggregator Pipeline...${DRY_RUN ? ' (DRY RUN: no database writes)' : ''}\n`);
    const browser = await time('browser.launch', () => puppeteer.launch({
         headless: false,
         ignoreHTTPSErrors: true
          }));
    let aggregatedEvents = [];

    // Loading all files from the scrapers directory
    const scrapersDir = path.join(__dirname, 'scrapers');
    const scraperFiles = fs.readdirSync(scrapersDir).filter(file => file.endsWith('.js'));

    const enabledModules = [];
    for (const file of scraperFiles) {
        const module = require(path.join(scrapersDir, file));
        if (!module.enabled) {
            console.log(`[SKIPPED] ${module.name || file} (disabled)`);
            continue;
        }
        enabledModules.push(module);
    }

    // Start every scraper at the same time instead of one after another.
    // Promise.allSettled waits for ALL of them and never throws: each result is
    // either { status: 'fulfilled', value } or { status: 'rejected', reason },
    // so one broken scraper still can't stop the others (same safety as before).
    console.log(`[SCRAPING] ${enabledModules.map(m => m.name).join(', ')} (in parallel; log lines may interleave)`);
    const outcomes = await Promise.allSettled(
        enabledModules.map(module => time(`scraper:${module.name}`, () => module.scrape(browser)))
    );

    outcomes.forEach((outcome, i) => {
        const name = enabledModules[i].name;
        if (outcome.status === 'fulfilled') {
            console.log(`  -> ${name}: found ${outcome.value.length} event(s)`);
            aggregatedEvents = aggregatedEvents.concat(outcome.value);
        } else {
            console.error(`  -> Failed to scrape ${name}:`, outcome.reason.message);
        }
    });

    // Remember this run's Gemini answers for next time (one file write, after
    // all scrapers finish, so they never overwrite each other's results).
    postCache.save();

    await time('browser.close', () => browser.close());

    // ---- DATA CLEANING PIPELINE -------------------------------------------
    // 1. Standardise: Instagram records were cleaned by their scrapers; website
    //    records (plain text) get tidied here so everything has the same shape.
    const records = aggregatedEvents.map(e => (e.sourceType ? e : cleanWebEvent(e)));
    // 2. Filter: drop events whose date has passed.
    const upcoming = await time('filter.dates', async () => formatAndFilterEvents(records));
    // 3. Deduplicate: merge records that describe the same real event.
    const merged = await time('dedupe.merge', async () => dedupeEvents(upcoming));

    // 4. Compare with what's already stored, so we UPDATE existing rows instead
    //    of inserting near-duplicates of them.
    const { data: existingRows, error: readError } = await time('supabase.read', () => supabase
        .from('events')
        .select('id, promotion, details, url, event_date')
        .gte('event_date', toIsoDate(new Date()))
        .order('id'));
    if (readError) {
        console.error('Could not read existing events, so nothing was written:', readError.message);
        printReport(performance.now() - runStart);
        return;
    }
    const plan = planWrites(merged, existingRows);

    console.log('\n=== DATA QUALITY REPORT ===');
    console.table({
        'records scraped': { count: records.length },
        'dropped (past date)': { count: records.length - upcoming.length },
        'merged away (duplicates)': { count: upcoming.length - merged.length },
        'unique upcoming events': { count: merged.length },
        'new rows to insert': { count: plan.inserts.length },
        'existing rows to update': { count: plan.updates.length },
        'existing rows unchanged': { count: plan.unchanged.length },
    });
    plan.warnings.forEach(w => console.warn(`[WARNING] ${w}`));
    plan.updates.forEach(u => console.log(`[UPDATE] row ${u.id}: "${u.before.details}"\n                -> "${u.row.details}"`));
    plan.inserts.forEach(r => console.log(`[INSERT] ${r.promotion} | ${r.details}`));

    // 5. Write.
    if (DRY_RUN) {
        await time('supabase.write (dry-run, skipped)', async () => {});
        console.log('\nDRY RUN: nothing was written to Supabase.');
    } else {
        let failures = 0;
        if (plan.inserts.length > 0) {
            const { error } = await time('supabase.insert', () => supabase
                .from('events')
                .upsert(plan.inserts, { onConflict: 'details' }));
            if (error) { failures++; console.error('Supabase insert error:', error.message); }
        }
        for (const { id, row } of plan.updates) {
            const { error } = await time('supabase.update', () => supabase
                .from('events').update(row).eq('id', id));
            if (error) { failures++; console.error(`Supabase update error (row ${id}):`, error.message); }
        }
        console.log(failures ? `\nDatabase sync finished with ${failures} error(s).` : '\nDatabase successfully synced.');
    }

    printReport(performance.now() - runStart);
}

runAggregator();
