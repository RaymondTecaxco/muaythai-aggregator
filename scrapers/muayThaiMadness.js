const { ApifyClient } = require('apify-client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize API Clients
const apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Helper function to pause the script (Throttling)
const delay = ms => new Promise(res => setTimeout(res, ms));

// Helper function: Downloads the Instagram image and converts it for Gemini
async function urlToGenerativePart(imageUrl, mimeType) {
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return {
        inlineData: { data: buffer.toString("base64"), mimeType },
    };
}

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
        
        const run = await apifyClient.actor("apify/instagram-profile-scraper").call(input);
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

        const extractedEvents = [];
        const model = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });

        console.log("  -> [Phase 2] Forking AI analysis (Image OCR vs Video Metadata)...");

        // Loop through both profiles returned by Apify
        for (const profile of items) {
            if (!profile || !profile.latestPosts) continue;

            const recentPosts = profile.latestPosts.slice(0, 10);

            // Loop through the 10 posts for the current profile
            for (const post of recentPosts) {
                try {
                    const captionText = post.caption || "";

                    // Pre-Filtering
                    // Drops videos/images that clearly have no event data.
                    const eventKeywords = /tickets|doors|pm|fights|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i;
                    if (!eventKeywords.test(captionText) && post.type === 'Video') {
                        console.log(`     - Skipping Video (No event keywords in caption)`);
                        continue; 
                    }

                    let prompt = `
                    You are an AI data extractor analyzing an Instagram post for a combat sports event.
                    The original Instagram caption is: "${captionText}"
                    
                    TASK 1: Determine if this post announces a specific upcoming fight event. 
                    If it is just a hype reel, training footage, or meme with no specific upcoming event data, reply EXACTLY with: {"isEvent": false}
                    
                    TASK 2: If it IS an upcoming event, extract the event name, date, time, and location.
                    Combine them into a single clean string. Use "${post.url}" for the URL.
                    
                    Return ONLY valid JSON in this exact structure, with no markdown formatting:
                    {
                        "isEvent": true,
                        "details": "Event Name - Location, State (Month Day. Time)",
                        "url": "extracted link"
                    }`;

                    let contentPayload = [];

                    if ((post.type === 'Image' || post.type === 'Sidecar') && post.displayUrl) {
                        const imagePart = await urlToGenerativePart(post.displayUrl, "image/jpeg");
                        contentPayload = [prompt, imagePart];
                    } else if (post.type === 'Video') {
                        prompt += `\nNOTE: This is a video post. Extract the data ENTIRELY from the caption text provided above.`;
                        contentPayload = [prompt];
                    } else {
                        continue; 
                    }

                    // Rate Limiting
                    // Pause for 15 seconds to ensure I never exceed 4 requests per minute.
                    console.log(`     - Throttling: Waiting 15 seconds for Gemini API Free-Tier limits...`);
                    await delay(15000); 

                    // Ask Gemini to analyze the payload
                    const result = await model.generateContent(contentPayload);
                    const responseText = result.response.text().replace(/```json|```/g, '').trim(); 
                    
                    const aiData = JSON.parse(responseText);

                    if (aiData.isEvent && aiData.details) {
                        extractedEvents.push({
                            promotion: '3 Kings Promotions',
                            details: aiData.details,
                            url: aiData.url
                        });
                        console.log(`     - AI found event via ${post.type}: ${aiData.details}`);
                    }

                } catch (err) {
                    console.error(`     - Error processing ${post.type} with Gemini:`, err.message);
                }
            }
        }

        return extractedEvents; 
    }
};