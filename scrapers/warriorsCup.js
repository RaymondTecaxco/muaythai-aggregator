const { time } = require('../utils/timer');

module.exports = {
    name: 'Warriors Cup',
    category: 'Major Regional',
    enabled: true,
    async scrape(browser) {
        const page = await browser.newPage();
        try {
            await time('web.page-load', () => page.goto('https://www.threepillarpromotions.com/shows', { waitUntil: 'networkidle2' }));

            const events = await time('web.extract', () => page.evaluate(() => {
                const results = [];
                const textBlocks = document.querySelectorAll('[data-testid="richTextElement"]');
                const ticketButtons = document.querySelectorAll('[data-hook="ev-rsvp-button"]');
                let buttonIndex = 0;

                textBlocks.forEach((block) => {
                    const text = block.innerText.trim();
                    if (text.includes("WARRIORS CUP")) {
                        const ticketLink = ticketButtons[buttonIndex] ? ticketButtons[buttonIndex].href : 'N/A';
                        results.push({
                            promotion: 'Warriors Cup',
                            details: text,
                            url: ticketLink
                        });
                        buttonIndex++;
                    }
                });
                return results;
            }));
            return events;
        } finally {
            await page.close();
        }
    }
};