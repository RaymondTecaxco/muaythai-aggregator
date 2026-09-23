require('dotenv').config();
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

// 1. Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ---------------------------------------------------------
// DATE FILTER LOGIC
// ---------------------------------------------------------

function filterPastEvents(events) {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to midnight for an accurate day comparison

    return events.filter(event => {
        // Regex to hunt for patterns like "9/18" or "Oct 3" in the text
        const dateMatch = event.details.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}|\d{1,2}\/\d{1,2}/i);
        
        if (dateMatch) {
            // Append the current year so JavaScript can accurately parse it
            const eventDate = new Date(`${dateMatch[0]} ${today.getFullYear()}`);
            
            // If the date parsed successfully and is older than today, drop it (return false)
            if (!isNaN(eventDate) && eventDate < today) {
                console.log(`Filtered out past event: ${event.details.substring(0, 30)}...`);
                return false; 
            }
        }
        // If it is in the future, or we couldn't parse a clear date, keep it just in case
        return true;
    });
}

// ---------------------------------------------------------
// PROMOTION-SPECIFIC SCRAPERS
// ---------------------------------------------------------

async function scrapeWarriorsCup(browser) {
    const page = await browser.newPage();
    await page.goto('https://www.threepillarpromotions.com/shows', { waitUntil: 'networkidle2' });
    
    const events = await page.evaluate(() => {
        const eventArray = [];
        const textBlocks = document.querySelectorAll('[data-testid="richTextElement"]');
        const ticketButtons = document.querySelectorAll('[data-hook="ev-rsvp-button"]');
        let buttonIndex = 0;

        textBlocks.forEach((block) => {
            const text = block.innerText.trim();
            if (text.includes("WARRIORS CUP")) {
                const ticketLink = ticketButtons[buttonIndex] ? ticketButtons[buttonIndex].href : 'N/A';
                eventArray.push({ promotion: 'Warriors Cup', details: text, url: ticketLink });
                buttonIndex++;
            }
        });
        return eventArray;
    });
    
    await page.close();
    return events;
}

async function scrapeFreedomFighters(browser) {
    const page = await browser.newPage();
    await page.goto('https://freedomfighterpromotions.com/', { waitUntil: 'domcontentloaded' });
    
    const events = await page.evaluate(() => {
        const eventArray = [];
        // Placeholder DOM selectors for Freedom Fighters
        const cards = document.querySelectorAll('.event-card-class'); 
        cards.forEach((card) => {
            eventArray.push({
                promotion: 'Freedom Fighter Promotions',
                details: card.innerText.trim() || 'Details TBA',
                url: card.querySelector('a')?.href || 'N/A'
            });
        });
        return eventArray;
    });
    
    await page.close();
    return events;
}

async function scrapeMuayThaiMadness(browser) {
    const page = await browser.newPage();
    await page.goto('https://www.simpletix.com/e/muay-thai-madness-23', { waitUntil: 'domcontentloaded' });
    
    const events = await page.evaluate(() => {
        const title = document.querySelector('title')?.innerText || 'Muay Thai Madness 23';
        return [{
            promotion: 'Muay Thai Madness',
            details: title + " - Bronx, NY (Oct 3)", // Hardcoded the date for the regex to catch
            url: window.location.href 
        }];
    });

    await page.close();
    return events;
}

// ---------------------------------------------------------
// MAIN PIPELINE EXECUTION
// ---------------------------------------------------------

async function runAggregator() {
    try {
        console.log("Starting NYC Event Aggregator...");
        const browser = await puppeteer.launch({ headless: true });
        
        let allUpcomingEvents = [];
        
        console.log("Scraping Warriors Cup...");
        allUpcomingEvents = allUpcomingEvents.concat(await scrapeWarriorsCup(browser));
        
        console.log("Scraping Freedom Fighters...");
        allUpcomingEvents = allUpcomingEvents.concat(await scrapeFreedomFighters(browser));
        
        console.log("Scraping Muay Thai Madness...");
        allUpcomingEvents = allUpcomingEvents.concat(await scrapeMuayThaiMadness(browser));
        
        await browser.close();

        // 3. Apply the time filter
        console.log("Filtering out past events...");
        const filteredEvents = filterPastEvents(allUpcomingEvents);

        // 4. Push the clean data to Supabase
        if (filteredEvents.length > 0) {
            console.log(`Found ${filteredEvents.length} upcoming events. Pushing to Supabase...`);
            
            // Note: We use .upsert() instead of .insert() to prevent duplicate rows 
            // if the script runs multiple times for the same event.
            const { data, error } = await supabase.from('events').upsert(filteredEvents, { onConflict: 'details' });
            
            if (error) throw error;
            console.log("Successfully updated the event database!");
        } else {
            console.log("No new upcoming events found across any promotions.");
        }

    } catch (error) {
        console.error("Critical error in the aggregator pipeline:", error.message);
    }
}

runAggregator();