// Finds the event date inside free text ("Muay Thai Madness 25 (January 23, 2027)",
// "WARRIORS CUP 81 FRI, 10/23. 6PM"), drops events that already happened, and
// attaches a clean event_date (YYYY-MM-DD) for the database.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const HALF_YEAR_MS = 182 * 24 * 60 * 60 * 1000;

// "January 23", "Jan. 23rd", "JANUARY, 23RD", "December 12. 2026", "Nov 14, 2026"
const MONTH_NAME_DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{1,2})(?:st|nd|rd|th)?\b(?:[.,]?\s*(\d{4})\b)?/i;
// "10/23", "10/23/26", "10/23/2026"
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/;

// Returns a Date (local midnight) for the first date found in `text`, or null.
function parseEventDate(text, today = new Date()) {
    let month, day, year;

    const named = text.match(MONTH_NAME_DATE);
    const numeric = text.match(NUMERIC_DATE);
    if (named) {
        month = MONTHS.indexOf(named[1].toLowerCase());
        day = Number(named[2]);
        year = named[3] ? Number(named[3]) : null;
    } else if (numeric) {
        month = Number(numeric[1]) - 1; // JS months count from 0 (January = 0)
        day = Number(numeric[2]);
        year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null;
    } else {
        return null;
    }

    if (year === null) {
        // No year written. Pick the year that puts the date CLOSEST to today:
        // in November, "January 23" means next January, while "November 14"
        // means last week. More than half a year away -> shift by one year.
        year = today.getFullYear();
        const guess = new Date(year, month, day);
        if (guess - today > HALF_YEAR_MS) year -= 1;      // e.g. "Dec 28" read in early January
        else if (today - guess > HALF_YEAR_MS) year += 1; // e.g. "Jan 23" read in November
    }

    const date = new Date(year, month, day);
    // new Date() quietly rolls "Feb 31" over into March; reject impossible dates.
    if (date.getMonth() !== month || date.getDate() !== day) return null;
    return date;
}

// Format using LOCAL date parts, so time zones can never shift the day.
function toIsoDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatAndFilterEvents(events) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const processedEvents = [];

    events.forEach(event => {
        // Records from utils/cleanEvents.js already carry a clean ISO date
        // ("2027-01-23"); otherwise, find the date inside the text.
        const textToSearch = event.details || event.caption || "";
        const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(event.event_date || '');
        const eventDate = iso
            ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
            : parseEventDate(textToSearch, today);

        if (eventDate) {
            if (eventDate < today) {
                console.log(`[FILTERED] Dropping past event: ${textToSearch.substring(0, 30)}...`);
                return;
            }
            event.event_date = toIsoDate(eventDate);
        }

        // No date found -> keep the event (date unknown), as before.
        processedEvents.push(event);
    });

    return processedEvents;
}

module.exports = formatAndFilterEvents;
module.exports.parseEventDate = parseEventDate;
