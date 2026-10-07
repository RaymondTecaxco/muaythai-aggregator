module.exports = {
    name: 'MuayThai Development League (MDL)',
    category: 'Grassroots & Development',
    enabled: true,
    async scrape(browser) {
        const page = await browser.newPage();
        try {
            await page.goto('https://www.muaythaidevelopmentleague.com/events', { waitUntil: 'domcontentloaded' });
            
            const events = await page.evaluate(() => {
                const results = [];
                // TODO: Inspect live site and replace '.event-card-placeholder'
                const cards = document.querySelectorAll('.event-card-placeholder');
                
                cards.forEach((card) => {
                    results.push({
                        promotion: 'MDL',
                        details: card.innerText.trim(),
                        url: card.querySelector('a')?.href || window.location.href
                    });
                });
                return results;
            });
            return events;
        } finally {
            await page.close();
        }
    }
};