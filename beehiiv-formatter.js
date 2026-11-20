// beehiiv-formatter.js
// Turns the upcoming events in Supabase into a newsletter section for beehiiv.
// Run with:  npm run newsletter
//
// It produces two versions of the same content:
//   1. output/beehiiv-newsletter.html, opened in your browser automatically.
//      Press Ctrl+A, then Ctrl+C, and paste into the beehiiv editor. Copying from a
//      browser puts RICH TEXT on the clipboard (headings, bold and clickable
//      links), and beehiiv keeps that formatting when you paste.
//   2. A plain-text version printed in the terminal, as a backup.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { toIsoDate } = require('./utils/cleanEvents');

const OUTPUT_FILE = path.join(__dirname, 'output', 'beehiiv-newsletter.html');
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

// Dead links and 404 pages scraped by mistake.
function isValid(details) {
    return Boolean(details) && !details.toLowerCase().includes('page not found');
}

// "2026-12-05" -> "December 2026". Events with no date get their own group.
function monthLabel(isoDate) {
    if (!isoDate) return 'Date to be announced';
    const [year, month] = isoDate.split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} ${year}`;
}

// Instagram links lead to the flyer, not a ticket page, so say what the reader gets.
function linkLabel(url) {
    return /instagram\.com/i.test(url) ? '📸 See the flyer' : '🎟️ Tickets & Info';
}

// HTML ESCAPING: characters like & and < have special meanings in HTML.
// "Three Pillar Promotions & RFC Promotions" must be written as "&amp;", or a
// browser could misread it. Text that came from a scraped website must always be
// escaped before it goes into HTML.
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Group events by month, keeping their order (they arrive sorted by date).
// A Map remembers insertion order, so the months stay in date order too.
function groupByMonth(events) {
    const groups = new Map();
    for (const event of events) {
        const label = monthLabel(event.event_date);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(event);
    }
    return groups;
}

// A PURE FUNCTION: same events in, same text out, with no database or files
// involved. That's what makes it easy to test (see tests/newsletter.test.js).
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

// Open a file in the default browser. Each operating system has its own command.
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

        // Let the DATABASE do the filtering and sorting, using the clean
        // event_date column (same rule as the upcoming_events view):
        //   event_date >= today  OR  event_date is unknown (null)
        // .or() takes PostgREST filter syntax: "column.operator.value", comma = OR.
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

// Only run when started directly (npm run newsletter), not when a test
// require()s this file to check buildNewsletter.
if (require.main === module) {
    formatForBeehiiv();
}

module.exports = { buildNewsletter, escapeHtml, monthLabel };
