const { time } = require('../utils/timer');

// Three Pillar Promotions lists both of its brands on this page.
const SHOW_BRANDS = /WARRIORS\s+(CUP|SERIES)/i;

module.exports = {
    name: 'Warriors Cup',
    category: 'Major Regional',
    enabled: true,
    async scrape(browser) {
        const page = await browser.newPage();
        try {
            await time('web.page-load', () => page.goto('https://www.threepillarpromotions.com/shows', { waitUntil: 'networkidle2' }));

            // regex passed as a string since evaluate() can't see this file's scope
            const events = await time('web.extract', () => page.evaluate((brandPattern) => {
                const brands = new RegExp(brandPattern, 'i');
                const results = [];
                const textBlocks = document.querySelectorAll('[data-testid="richTextElement"]');

                // The site has used both a Wix RSVP button and a plain "GET TICKETS"
                // link to Ticketmaster, so accept either.
                const ticketLinks = [...document.querySelectorAll('a[href]')].filter(a =>
                    a.matches('[data-hook="ev-rsvp-button"]')
                    || /\btickets?\b/i.test(a.innerText || '')
                    || /ticketmaster\.|eventbrite\.|seetickets\.|dice\.fm/i.test(a.href));
                const used = new Set();

                // Pair each show with the next unused ticket link after it in the
                // DOM. Pairing by index broke whenever the page had an extra block.
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
                            // company name, not the brand, so these merge with the flyers
                            promotion: 'Three Pillar Promotions',
                            details: text,
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
