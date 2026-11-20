const { time } = require('../utils/timer');

// Three Pillar Promotions runs two show brands, Warriors Cup and Warriors Series,
// and lists both on one page. The \s+ allows any spacing, and the i flag ignores
// capitals, so "WARRIORS CUP 81" and "Warriors Series IV" both match.
const SHOW_BRANDS = /WARRIORS\s+(CUP|SERIES)/i;

module.exports = {
    name: 'Warriors Cup',
    category: 'Major Regional',
    enabled: true,
    async scrape(browser) {
        const page = await browser.newPage();
        try {
            await time('web.page-load', () => page.goto('https://www.threepillarpromotions.com/shows', { waitUntil: 'networkidle2' }));

            // page.evaluate runs inside the browser and can't see variables from this
            // file, so the regex is passed in as text (its .source) and rebuilt there.
            const events = await time('web.extract', () => page.evaluate((brandPattern) => {
                const brands = new RegExp(brandPattern, 'i');
                const results = [];
                const textBlocks = document.querySelectorAll('[data-testid="richTextElement"]');

                // Ticket buttons have come in two styles on this site:
                //   - the old Wix Events "RSVP" button (data-hook="ev-rsvp-button")
                //   - a plain "GET TICKETS" link straight to Ticketmaster (current)
                // Accept either, plus any link to a known ticketing site.
                const ticketLinks = [...document.querySelectorAll('a[href]')].filter(a =>
                    a.matches('[data-hook="ev-rsvp-button"]')
                    || /\btickets?\b/i.test(a.innerText || '')
                    || /ticketmaster\.|eventbrite\.|seetickets\.|dice\.fm/i.test(a.href));
                const used = new Set();

                // Pair each show with the first unused ticket link that comes AFTER its
                // text on the page. compareDocumentPosition tells us whether one element
                // comes before or after another in the page's HTML. This is sturdier than
                // pairing "1st text block with 1st button", which breaks as soon as the
                // page has one extra text block or button.
                function ticketLinkAfter(block) {
                    const link = ticketLinks.find(a => !used.has(a)
                        && (block.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING));
                    if (link) used.add(link);
                    return link?.href || '';
                }

                textBlocks.forEach((block) => {
                    const text = block.innerText.trim();
                    if (brands.test(text)) {
                        results.push({
                            // The company, not the brand, so these records merge with
                            // flyers for the same show (which name Three Pillar Promotions).
                            promotion: 'Three Pillar Promotions',
                            details: text,
                            // Empty when there's no ticket link yet. cleanWebEvent then
                            // falls back to this shows page as the link.
                            url: ticketLinkAfter(block),
                            pageUrl: window.location.href,
                        });
                    }
                });
                return results;
            }, SHOW_BRANDS.source));
            return events;
        } finally {
            await page.close();
        }
    }
};
