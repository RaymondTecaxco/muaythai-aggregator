// Reads one Instagram post with Gemini, checking the cache by post ID before
// downloading anything and by content hash before calling the API.

const cache = require('./postCache');
const { askGemini, downloadImage } = require('./gemini');
const { addCount } = require('./timer');
const { toIsoDate } = require('./cleanEvents');

// Bump when the prompt or response shape changes so old cache entries are
// ignored. v2 = separate fields instead of one details string.
const CACHE_VERSION = 'v2';

function isImagePost(post) {
    return (post.type === 'Image' || post.type === 'Sidecar') && Boolean(post.displayUrl);
}

// The response format is enforced by the schema in gemini.js.
function buildPayload(post, caption, image) {
    const prompt = `You are a data extractor reading an Instagram post from the account "${post.ownerUsername || 'unknown'}".
The account is a combat sports gym or promotion (Muay Thai, kickboxing, boxing, MMA).
Today's date is ${toIsoDate(new Date())}.
The post caption is: "${caption}"

Decide whether this post announces or promotes a specific UPCOMING event (a date after today).
Recaps of past events, training footage, gym adverts and memes are NOT events, unless the
post also announces the next event; in that case, extract the NEXT event.
Copy each fact as it is written on the flyer or in the caption. Leave a field empty if it is
not stated; never guess or invent a value.${image ? '' : '\nThis is a video post: use ONLY the caption text above.'}`;
    return image ? [prompt, image.part] : [prompt];
}

async function analyzeInstagramPost(post) {
    const postKey = `${CACHE_VERSION}:post:${post.shortCode || post.url}`;
    const known = cache.get(postKey);
    if (known !== undefined) {
        addCount('cache.hit (post seen before)');
        return known;
    }

    const caption = post.caption || '';
    const image = isImagePost(post) ? await downloadImage(post.displayUrl) : null;
    const contentKey = `${CACHE_VERSION}:content:${cache.sha256(`${caption}\n${image ? image.hash : 'no-image'}`)}`;

    const aiData = await cache.getOrCompute(contentKey, () => askGemini(buildPayload(post, caption, image)));
    cache.set(postKey, aiData);
    return aiData;
}

module.exports = { analyzeInstagramPost, isImagePost, CACHE_VERSION };
