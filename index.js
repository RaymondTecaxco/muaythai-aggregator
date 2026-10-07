require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const filterPastEvents = require('./utils/filterEvents');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function runAggregator() {
    console.log("Starting Tri-State Muay Thai Aggregator Pipeline...\n");
    const browser = await puppeteer.launch({ headless: true });
    let aggregatedEvents = [];

    // Dynamically load all files from the scrapers directory
    const scrapersDir = path.join(__dirname, 'scrapers');
    const scraperFiles = fs.readdirSync(scrapersDir).filter(file => file.endsWith('.js'));

    for (const file of scraperFiles) {
        const module = require(path.join(scrapersDir, file));
        
        if (!module.enabled) {
            console.log(`[SKIPPED] ${module.name} (disabled)`);
            continue;
        }

        console.log(`[SCRAPING] ${module.name} (${module.category})...`);
        try {
            const data = await module.scrape(browser);
            console.log(`  -> Found ${data.length} event(s)`);
            aggregatedEvents = aggregatedEvents.concat(data);
        } catch (err) {
            console.error(`  -> Failed to scrape ${module.name}:`, err.message);
        }
    }

    await browser.close();

    const cleanEvents = filterPastEvents(aggregatedEvents);
    console.log(`\nTotal valid upcoming events: ${cleanEvents.length}`);

    if (cleanEvents.length > 0) {
        const { error } = await supabase
            .from('events')
            .upsert(cleanEvents, { onConflict: 'details' });

        if (error) {
            console.error("Supabase upsert error:", error.message);
        } else {
            console.log("Database successfully synced.");
        }
    }
}

runAggregator();