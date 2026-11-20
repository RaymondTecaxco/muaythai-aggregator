// Battle in the Basement (Church Street Boxing Gym), ticketed on Eventbrite.
//
// Starts from the gym's organizer page rather than a single event URL, since
// every new show gets a new URL. Each event page's JSON-LD then gives the
// name, date, venue and ticket link directly.

const { time } = require('../utils/timer');
const { cleanListingEvent } = require('../utils/cleanEvents');

const ORGANIZER_URL = 'https://www.eventbrite.com/o/church-street-boxing-gym-8030472550';
// the gym also lists boxing nights and other events
const SERIES = /battle[\s-]+in[\s-]+the[\s-]+basement/i;
const PROMOTION = 'Battle in the Basement';

// Runs in the page. Matches any schema.org type ending in "Event"
// (SportsEvent, SocialEvent, ...).
function readEventStructuredData() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        let data;
        try { data = JSON.parse(script.textContent); } catch { continue; }
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
            await time('web.page-load', () => page.goto(ORGANIZER_URL, { waitUntil: 'networkidle2' }));
            const cards = await time('web.extract', () => page.evaluate(() =>
                [...document.querySelectorAll('a[href*="/e/"]')].map(a => ({
                    url: a.href.split('?')[0],                    // strip tracking params
                    text: a.innerText || a.getAttribute('aria-label') || '',
                }))
            ));
            // Each event is linked several times on the page. The slug
            // (/e/battle-in-the-basement-23-tickets-...) usually has the series
            // name even when the link text doesn't.
            const eventUrls = [...new Set(cards
                .filter(card => SERIES.test(card.url) || SERIES.test(card.text))
                .map(card => card.url))];

            const events = [];
            for (const url of eventUrls) {
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
