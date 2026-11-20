// scrapers/battleInTheBasement.js
// Battle in the Basement: Church Street Boxing Gym's Muay Thai show, ticketed on Eventbrite.
//
// Two steps:
//   1. Open the gym's Eventbrite ORGANIZER page, which lists every upcoming event,
//      and collect the links to Battle in the Basement events. Starting from the
//      organizer page (not one event's URL) means a newly announced show is picked
//      up automatically; each new event gets a brand-new URL.
//   2. Open each event page and read its schema.org "Event" structured data
//      (see cleanListingEvent in utils/cleanEvents.js) for the name, date, time,
//      venue and ticket link.

const { time } = require('../utils/timer');
const { cleanListingEvent } = require('../utils/cleanEvents');

const ORGANIZER_URL = 'https://www.eventbrite.com/o/church-street-boxing-gym-8030472550';
// The gym also runs other shows (e.g. boxing nights), so keep only this series.
const SERIES = /battle[\s-]+in[\s-]+the[\s-]+basement/i;
const PROMOTION = 'Battle in the Basement';

// Runs INSIDE the browser (via page.evaluate): find the page's JSON-LD blocks
// (<script type="application/ld+json">) and return the one describing an event.
// schema.org event types all end in "Event" (Event, SocialEvent, SportsEvent...).
function readEventStructuredData() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        let data;
        try { data = JSON.parse(script.textContent); } catch { continue; } // skip malformed blocks
        const found = [data].flat().find(d => d && /Event$/.test(d['@type'] || ''));
        if (found) return found;
    }
    return null;
}

module.exports = {
    name: 'Battle in the Basement',
    category: 'Grassroots & Development',
    enabled: true,
    async scrape(browser) {
        const page = await browser.newPage();
        try {
            // ---- Step 1: event links from the organizer page ----
            await time('web.page-load', () => page.goto(ORGANIZER_URL, { waitUntil: 'networkidle2' }));
            const cards = await time('web.extract', () => page.evaluate(() =>
                [...document.querySelectorAll('a[href*="/e/"]')].map(a => ({
                    url: a.href.split('?')[0],                    // drop tracking parameters
                    text: a.innerText || a.getAttribute('aria-label') || '',
                }))
            ));
            // The same event appears several times (image, title, button), so a
            // Set keeps each URL once. A URL slug looks like
            // "/e/battle-in-the-basement-23-tickets-2003210212671", so the series
            // name can be checked in the link itself as well as the visible text.
            const eventUrls = [...new Set(cards
                .filter(card => SERIES.test(card.url) || SERIES.test(card.text))
                .map(card => card.url))];

            // ---- Step 2: structured data from each event page ----
            const events = [];
            for (const url of eventUrls) {
                // One event failing (slow page, layout change) shouldn't lose the others.
                try {
                    await time('web.page-load', () => page.goto(url, { waitUntil: 'networkidle2' }));
                    const listing = await time('web.extract', () => page.evaluate(readEventStructuredData));
                    if (!listing || !SERIES.test(listing.name || '')) {
                        console.warn(`[Battle in the Basement] No event data found at ${url}`);
                        continue;
                    }
                    if (/Cancelled/i.test(listing.eventStatus || '')) {
                        console.log(`[Battle in the Basement] Skipping cancelled event: ${listing.name}`);
                        continue;
                    }
                    events.push(cleanListingEvent(listing, { defaultPromotion: PROMOTION }));
                } catch (error) {
                    console.error(`[Battle in the Basement] Failed to read ${url}:`, error.message);
                }
            }
            return events;
        } catch (error) {
            console.error('Failed to extract Battle in the Basement', error.message);
            return [];
        } finally {
            await page.close();
        }
    }
};
