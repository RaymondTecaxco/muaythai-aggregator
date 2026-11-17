const { ApifyClient } = require('apify-client');
const { time, addCount } = require('../utils/timer');
const { analyzeInstagramPost, isImagePost } = require('../utils/instagram');
const { cleanInstagramEvent } = require('../utils/cleanEvents');

// Initialize API Clients
const apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

// Pre-filter for VIDEO posts (Gemini only sees their caption, not the video).
// A video is worth an AI call only if its caption has a concrete date
// ("Nov 14", "JANUARY, 23RD", "12/12") or talks about tickets / doors.
// \b = "word boundary", so "pm" no longer matches inside "equipment"
// and "dec" no longer matches inside "decided".
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
const EVENT_SIGNAL = new RegExp(
    `\\b${MONTH}\\.?,?\\s*\\d{1,2}(?:st|nd|rd|th)?\\b` + // month name + day
    `|\\b\\d{1,2}\\/\\d{1,2}\\b` +                         // 11/14
    `|\\btickets?\\b|\\bdoors\\b`,                         // ticket / doors-open talk
    'i'
);

module.exports = {
    name: '3 Kings / Lion\'s Roar',
    category: 'Grassroots & Development',
    enabled: true,
    async scrape(browser) {
        console.log("  -> [Phase 1] Triggering Apify for the 3 Kings ecosystem...");

        // The Ecosystem Sweep & Expanded Limit
        // Apify accepts an array of usernames. Pass both profiles to scrape them in a single call.
        const input = {
            "usernames": ["3kings_promotions", "lionsroarnyc"],
            "resultsLimit": 10
        };

        const run = await time('apify.actor-run', () => apifyClient.actor("apify/instagram-profile-scraper").call(input));
        const { items } = await time('apify.dataset-fetch', () => apifyClient.dataset(run.defaultDatasetId).listItems());

        // Gather the posts worth analysing from both profiles into one list.
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

        // Start all posts at once; the shared rate limiter spaces out the Gemini calls.
        const results = await Promise.all(postsToAnalyse.map(async (post) => {
            try {
                return await analyzeInstagramPost(post);
            } catch (err) {
                console.error(`     - Error processing ${post.type} ${post.shortCode} with Gemini:`, err.cause?.message || err.message);
                return null;
            }
        }));

        // Clean each answer into the standard event shape. Duplicates (3 Kings and
        // Lion's Roar often post the same announcement) are merged later, across
        // ALL scrapers, by utils/dedupeEvents.js.
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
