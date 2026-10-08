module.exports = {
    name: 'Freedom Fighter Promotions',
    category: 'Major Regional',
    enabled: true,
    async scrape(browser) {
        const page = await browser.newPage();
        try {
            await page.goto('https://tickets.freedomfighterpromotions.com/', { waitUntil: 'networkidle2' });

            await page.waitForSelector('.event-card', {timeout: 10000})
            
            const events = await page.evaluate(() => {
                const results = [];
                
                const cards = document.querySelectorAll('.event-card'); 
                
                cards.forEach((card) => {
                    results.push({
                        promotion: 'Freedom Fighter Promotions',
                        details: card.querySelector('h3')?.innerText.trim() || 'Details TBA',
                        url: card.href || window.location.href
                    });
                });
                return results;
            });
            return events;
        } catch(error) {
            console.error("Failed to extract Freedom Fighters", error.message);
            return[];
        } finally {
            await page.close();
        }
    }
};