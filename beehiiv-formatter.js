// Builds the upcoming-events section of the newsletter (npm run newsletter).
//
// Writes output/beehiiv-newsletter.html and opens it in the browser. Copying
// from the browser keeps headings, bold and links when pasted into beehiiv,
// which copying plain text doesn't. A plain-text version is also printed to
// the terminal as a fallback.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { toIsoDate } = require('./utils/cleanEvents');

const OUTPUT_FILE = path.join(__dirname, 'output', 'beehiiv-newsletter.html');
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

// filters out 404 pages that got scraped as events
function isValid(details) {
    return Boolean(details) && !details.toLowerCase().includes('page not found');
}

// "2026-12-05" -> "December 2026"
function monthLabel(isoDate) {
    if (!isoDate) return 'Date to be announced';
    const [year, month] = isoDate.split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} ${year}`;
}

// Instagram links go to the flyer, not tickets, so label them differently.
function linkLabel(url) {
    return /instagram\.com/i.test(url) ? '📸 See the flyer' : '🎟️ Tickets & Info';
}

// All scraped text goes through this before it's put in the HTML.
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Events arrive sorted by date, and Map keeps insertion order, so the
// months come out in order too.
function groupByMonth(events) {
    const groups = new Map();
    for (const event of events) {
        const label = monthLabel(event.event_date);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(event);
    }
    return groups;
}

// Kept free of I/O so it can be unit tested.
function buildNewsletter(events) {
    const groups = groupByMonth(events);
    const html = [];
    const text = [];

    for (const [month, monthEvents] of groups) {
        html.push(`<h2>${escapeHtml(month)}</h2>`);
        text.push(month.toUpperCase(), '');
        for (const event of monthEvents) {
            const link = event.url
                ? `<br><a href="${escapeHtml(event.url)}">${escapeHtml(linkLabel(event.url))}</a>`
                : '';
            html.push(`<p><strong>🥊 ${escapeHtml(event.promotion)}</strong><br>${escapeHtml(event.details)}${link}</p>`);
            text.push(`🥊 ${event.promotion}`, event.details);
            if (event.url) text.push(`${linkLabel(event.url)}: ${event.url}`);
            text.push('');
        }
    }
    return { html: html.join('\n'), text: text.join('\n').trimEnd() };
}

function writeHtmlPage(bodyHtml) {
    const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>beehiiv: upcoming fights</title></head>
<body>
${bodyHtml}
</body>
</html>
`;
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, page, 'utf8');
}

function openInBrowser(file) {
    const command = process.platform === 'win32' ? `start "" "${file}"`
        : process.platform === 'darwin' ? `open "${file}"`
        : `xdg-open "${file}"`;
    exec(command, error => {
        if (error) console.log(`(Couldn't open the browser automatically. Open this file yourself: ${file})`);
    });
}

async function formatForBeehiiv() {
    try {
        console.log("Fetching upcoming events from Supabase...\n");
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

        // same rule as the upcoming_events view: today or later, or no date yet
        const today = toIsoDate(new Date());
        const { data: events, error } = await supabase
            .from('events')
            .select('*')
            .or(`event_date.gte.${today},event_date.is.null`)
            .order('event_date', { ascending: true, nullsFirst: false });

        if (error) throw error;

        const upcomingEvents = (events || []).filter(e => isValid(e.details));

        if (upcomingEvents.length === 0) {
            console.log("No upcoming events found in the database.");
            return;
        }

        const { html, text } = buildNewsletter(upcomingEvents);
        writeHtmlPage(html);

        console.log(`=== ${upcomingEvents.length} upcoming event(s) ===\n`);
        console.log('BEST: a browser tab is opening with the formatted version.');
        console.log('      Press Ctrl+A, then Ctrl+C there, and paste into beehiiv.');
        console.log(`      (File: ${OUTPUT_FILE})\n`);
        console.log('=== PLAIN-TEXT BACKUP: COPY BELOW THIS LINE ===\n');
        console.log(text);
        console.log('\n=== END OF DATA ===');

        openInBrowser(OUTPUT_FILE);
    } catch (error) {
        console.error("Error fetching data:", error.message);
    }
}

// don't hit Supabase when the tests require this file
if (require.main === module) {
    formatForBeehiiv();
}

module.exports = { buildNewsletter, escapeHtml, monthLabel };
