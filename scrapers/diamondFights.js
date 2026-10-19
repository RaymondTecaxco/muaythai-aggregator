const { ApifyClient } = require('apify-client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize API Clients
const apifyClient = new ApifyClient({ token: process.env.APIFY_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
    name: 'Diamond Fights (AI Vision OCR)',
    category: 'Grassroots & Development',
    enabled: true,
    async scrape(browser) {
        console.log("  -> [Phase 1] Triggering Apify to fetch Instagram images...");
        const input = { "usernames": ["diamondheart_sg"], "resultsLimit": 5 };
        const run = await apifyClient.actor("apify/instagram-profile-scraper").call(input);
        const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();

        const profileData = items[0];
        if (!profileData || !profileData.latestPosts) return [];

        const recentPosts = profileData.latestPosts.slice(0, 5);
        const extractedEvents = [];

        // Initialize the Gemini 3.8 Flash model
        const model = genAI.getGenerativeModel({ model: "gemini-3.8-flash" });

        console.log("  -> [Phase 2] Sending images to Gemini Vision API for analysis...");

        // Loop through recent posts on Instagram
        for (const post of recentPosts) {
            if ((post.type === 'Image' || post.type === 'Sidecar') && post.displayUrl) {
                try {
                    // 1. Convert the image to base64
                    const imagePart = await urlToGenerativePart(post.displayUrl, "image/jpeg");

                    // 2. The AI Prompt
                    const prompt = `
                    You are an AI data extractor analyzing an Instagram image.
                    The original Instagram caption is: "${post.caption || ""}"
                    
                    TASK 1: Determine if this image is a flyer/poster for a combat sports event. 
                    If it is just a photo of a dog, people training, or a meme, reply EXACTLY with: {"isEvent": false}
                    
                    TASK 2: If it IS a fight flyer, extract the event name, date, time, and location.
                    Combine them into a single clean string. If no ticket link is found on the flyer or caption, use "${post.url}".
                    
                    Return ONLY valid JSON in this exact structure, with no markdown formatting:
                    {
                        "isEvent": true,
                        "details": "Event Name - Location, State (Month Day. Time)",
                        "url": "extracted link"
                    }`;

                    // 3. Ask Gemini to read the image
                    const result = await model.generateContent([prompt, imagePart]);
                    const responseText = result.response.text().replace(/```json|```/g, '').trim(); // Strip markdown
                    
                    const aiData = JSON.parse(responseText);

                    // 4. Map to the Supabase schema
                    if (aiData.isEvent && aiData.details) {
                        extractedEvents.push({
                            promotion: 'Diamond Fights Ice Breaker',
                            details: aiData.details, 
                            url: aiData.url          
                        });
                        console.log(`     - AI found event: ${aiData.details}`);
                    } else {
                        console.log(`     - AI ignored image (Not a fight flyer)`);
                    }

                } catch (err) {
                    console.error("     - Error processing image with Gemini:", err.message);
                }
            }
        }

        console.log(`  -> AI successfully validated ${extractedEvents.length} events.`);
        
        // Return the clean objects back to index.js
        return extractedEvents; 
    }
};