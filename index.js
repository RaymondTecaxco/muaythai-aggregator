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

// --dry-run (or DRY_RUN=1) runs everything except the database writes.
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

async function runAggregator() {
    const runStart = performance.now();
    console.log(`Starting Tri-State Muay Thai Aggregator Pipeline...${DRY_RUN ? ' (DRY RUN: no database writes)' : ''}\n`);
    const browser = await time('browser.launch', () => puppeteer.launch({
         headless: false,
         ignoreHTTPSErrors: true
          }));
    let aggregatedEvents = [];

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

    // Run scrapers in parallel. allSettled so one failing scraper doesn't
    // take down the rest.
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

    // saved once after all scrapers finish so they can't overwrite each other
    postCache.save();

    await time('browser.close', () => browser.close());

    // Instagram/Eventbrite records are already cleaned by their scrapers;
    // website records are plain text and get cleaned here.
    const records = aggregatedEvents.map(e => (e.sourceType ? e : cleanWebEvent(e)));
    const upcoming = await time('filter.dates', async () => formatAndFilterEvents(records));
    const merged = await time('dedupe.merge', async () => dedupeEvents(upcoming));

    // Match against stored rows so re-runs update instead of inserting duplicates.
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
