const { ApifyClient } = require('apify-client');
const { time, addCount } = require('../utils/timer');
const { analyzeInstagramPost, isImagePost } = require('../utils/instagram');
const { cleanInstagramEvent } = require('../utils/cleanEvents');

const apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

// Gemini only gets the caption for videos, so skip videos whose caption has
// no date or ticket/doors mention. Word boundaries stop matches like "dec"
// inside "decided".
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const EVENT_SIGNAL = new RegExp(
    `\\b${MONTH}\\.?,?\\s*\\d{1,2}(?:st|nd|rd|th)?\\b` + // month name + day
    `|\\b\\d{1,2}\\/\\d{1,2}\\b` +                         // 11/14
    `|\\btickets?\\b|\\bdoors\\b`,
    'i'
);

module.exports = {
    name: '3 Kings / Lion\'s Roar',
    category: 'Grassroots & Development',
    enabled: true,
    async scrape(browser) {
        console.log("  -> [Phase 1] Triggering Apify for the 3 Kings ecosystem...");

        // both accounts in one Apify run
        const input = {
            "usernames": ["3kings_promotions", "lionsroarnyc"],
            "resultsLimit": 10
        };

        const run = await time('apify.actor-run', () => apifyClient.actor("apify/instagram-profile-scraper").call(input));
        const { items } = await time('apify.dataset-fetch', () => apifyClient.dataset(run.defaultDatasetId).listItems());

        const postsToAnalyse = [];
        for (const profile of items) {
            if (!profile || !profile.latestPosts) continue;
            for (const post of profile.latestPosts.slice(0, 10)) {
                if (isImagePost(post)) {
                    postsToAnalyse.push(post);
                } else if (post.type === 'Video' && EVENT_SIGNAL.test(post.caption || '')) {
                    postsToAnalyse.push(post);
                } else {
                    addCount('prefilter.skipped posts');
                }
            }
        }

        console.log(`  -> [Phase 2] Analysing ${postsToAnalyse.length} post(s) (cached ones are skipped)...`);

        // the rate limiter in utils/gemini.js spaces these out
        const results = await Promise.all(postsToAnalyse.map(async (post) => {
            try {
                return await analyzeInstagramPost(post);
            } catch (err) {
                console.error(`     - Error processing ${post.type} ${post.shortCode} with Gemini:`, err.cause?.message || err.message);
                return null;
            }
        }));

        // 3 Kings and Lion's Roar often repost the same flyer; dedupeEvents
        // merges those later.
        const events = [];
        results.forEach((aiData, i) => {
            if (!aiData || !aiData.isEvent) return;
            const event = cleanInstagramEvent(aiData, {
                defaultPromotion: '3 Kings Promotions',
                post: postsToAnalyse[i],
            });
            events.push(event);
            console.log(`     - AI found event via ${event.sourceType}: ${event.details}`);
        });

        return events;
    }
};
