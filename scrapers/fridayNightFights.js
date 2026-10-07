module.exports = {
    name: 'Friday Night Fights',
    category: 'Major Regional',
    enabled: true,
    async scrape(browser) {
        const page = await browser.newPage();
        try {
            await page.goto('https://fridaynightfights.com/', { waitUntil: 'domcontentloaded' });
            
            const events = await page.evaluate(() => {
                const results = [];
                // TODO: Inspect live site and replace '.event-card-placeholder'
                const cards = document.querySelectorAll('.event-card-placeholder');
                
                cards.forEach((card) => {
                    results.push({
                        promotion: 'Friday Night Fights',
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