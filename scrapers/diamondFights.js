const { ApifyClient } = require('apify-client');
const { time } = require('../utils/timer');
const { analyzeInstagramPost, isImagePost } = require('../utils/instagram');
const { cleanInstagramEvent } = require('../utils/cleanEvents');

const apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

module.exports = {
    name: 'Diamond Fights (AI Vision OCR)',
    category: 'Grassroots & Development',
    enabled: true,
    async scrape(browser) {
        console.log("  -> [Phase 1] Triggering Apify to fetch Instagram images...");
        const input = { "usernames": ["diamondheart_sg"], "resultsLimit": 5 };
        const run = await time('apify.actor-run', () => apifyClient.actor("apify/instagram-profile-scraper").call(input));
        const { items } = await time('apify.dataset-fetch', () => apifyClient.dataset(run.defaultDatasetId).listItems());

        const profileData = items[0];
        if (!profileData || !profileData.latestPosts) return [];

        // this account only announces events with image flyers
        const recentPosts = profileData.latestPosts.slice(0, 5).filter(isImagePost);

        console.log(`  -> [Phase 2] Analysing ${recentPosts.length} image post(s) (cached ones are skipped)...`);

        const results = await Promise.all(recentPosts.map(async (post) => {
            try {
                return await analyzeInstagramPost(post);
            } catch (err) {
                console.error(`     - Error processing ${post.shortCode} with Gemini:`, err.cause?.message || err.message);
                return null;
            }
        }));

        // The gym reposts other promotions' shows, so the promoter on the flyer
        // takes priority over the account name.
        const events = [];
        results.forEach((aiData, i) => {
            if (!aiData || !aiData.isEvent) return;
            const event = cleanInstagramEvent(aiData, {
                defaultPromotion: 'Diamond Fights Ice Breaker',
                post: recentPosts[i],
            });
            events.push(event);
            console.log(`     - AI found event: ${event.details}`);
        });

        console.log(`  -> AI successfully validated ${events.length} events.`);
        return events;
    }
};
