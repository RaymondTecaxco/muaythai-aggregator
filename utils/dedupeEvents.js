// utils/dedupeEvents.js
// RECORD LINKAGE (also called entity resolution): deciding when two records
// describe the same real-world event, even though they're worded differently,
// then MERGING them into one "golden record" that keeps the best of each.
//
// Our rule for "same event":
//   same event_date   AND   ( same promotion  OR  same venue  OR  same event name )
// Different events on the same night (e.g. two NYC shows on one Saturday) stay
// separate because they differ in promotion, venue AND name.

const { comparisonKey, buildDetails } = require('./cleanEvents');

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

// Two venue names match if one contains the other:
// "Infosys Theater at Madison Square Garden" contains "Madison Square Garden".
function sameVenue(a, b) {
    const ka = comparisonKey(a);
    const kb = comparisonKey(b);
    if (!ka || !kb) return false;               // unknown venue never matches
    return ka.includes(kb) || kb.includes(ka);
}

function samePromotion(a, b) {
    // Compare only the FIRST promoter, so "Three Pillar Promotions & RFC Promotions"
    // still matches "Three Pillar Promotions".
    const first = p => comparisonKey(String(p).split(' & ')[0]);
    return Boolean(a && b) && first(a) === first(b);
}

function sameEvent(a, b) {
    if (!a.event_date || a.event_date !== b.event_date) return false; // no date -> can't be sure
    return samePromotion(a.promotion, b.promotion)
        || sameVenue(a.venue, b.venue)
        || (Boolean(a.eventName) && comparisonKey(a.eventName) === comparisonKey(b.eventName));
}

// ---------------------------------------------------------------------------
// Merging: score how complete each record is, keep the best, fill its gaps
// ---------------------------------------------------------------------------

// A simple "data quality score": more known fields = more useful record.
function completeness(r) {
    return (r.eventName ? 3 : 0)
        + (r.promoterFromFlyer ? 2 : 0)   // named on the flyer beats our account-based guess
        + (r.venue ? 2 : 0)
        + (r.city ? 1 : 0)
        + (r.time ? 1 : 0)
        + (r.hasTicketLink ? 1 : 0)
        + (r.sourceType === 'Image' || r.sourceType === 'Sidecar' ? 1 : 0); // a flyer beats a caption
}

const FILLABLE = ['eventName', 'venue', 'city', 'state', 'time'];

// "Coalescing": start from the best record, and for every field it's missing,
// take the value from the next-best record that has one.
function mergeGroup(group) {
    const ranked = [...group].sort((a, b) => completeness(b) - completeness(a));
    const merged = { ...ranked[0] };
    for (const field of FILLABLE) {
        if (!merged[field]) merged[field] = ranked.find(r => r[field])?.[field] || '';
    }
    const flyerPromoter = ranked.find(r => r.promoterFromFlyer);
    if (flyerPromoter) {
        merged.promotion = flyerPromoter.promotion;
        merged.promoterFromFlyer = true;
    }
    const withTicket = ranked.find(r => r.hasTicketLink);
    if (withTicket) {
        merged.url = withTicket.url;
        merged.hasTicketLink = true;
    }
    // Website records keep their own wording; for the rest, rebuild the
    // standard text from the merged fields.
    if (merged.sourceType !== 'Website') {
        const [y, m, d] = (merged.event_date || '').split('-').map(Number);
        merged.details = buildDetails({ ...merged, date: y ? new Date(y, m - 1, d) : null });
    }
    merged.mergedFrom = group.length;
    return merged;
}

// Group records that describe the same event, then merge each group.
function dedupeEvents(records) {
    const groups = [];
    for (const record of records) {
        const group = groups.find(g => g.some(member => sameEvent(member, record)));
        if (group) group.push(record);
        else groups.push([record]);
    }
    return groups.map(group => {
        const merged = mergeGroup(group);
        if (group.length > 1) {
            console.log(`[MERGED] ${group.length} records -> "${merged.details}"`);
            for (const r of group) console.log(`           <- "${r.details}" (${r.sourceType}, ${r.sourceUrl})`);
        }
        return merged;
    });
}

// ---------------------------------------------------------------------------
// Matching against rows ALREADY in Supabase (so a new run updates a row
// instead of inserting a duplicate of it)
// ---------------------------------------------------------------------------

// Existing rows only have promotion / details / url / event_date, so for them
// we look for the new event's venue or name INSIDE the stored details text.
function matchesExistingRow(event, row) {
    if (!event.event_date || event.event_date !== row.event_date) return false;
    const rowText = comparisonKey(row.details);
    return samePromotion(event.promotion, row.promotion)
        || (comparisonKey(event.venue).length > 0 && rowText.includes(comparisonKey(event.venue)))
        || (comparisonKey(event.eventName).length > 0 && rowText.includes(comparisonKey(event.eventName)))
        || comparisonKey(event.details) === rowText;
}

// Only these columns exist in the `events` table; everything else is
// working data for cleaning and matching and must not be sent to Supabase.
function toRow(event) {
    return {
        promotion: event.promotion,
        details: event.details,
        url: event.url,
        event_date: event.event_date,
    };
}

// Decide, for each event, whether to INSERT it, UPDATE an existing row, or
// leave that row alone because nothing changed.
function planWrites(events, existingRows) {
    const plan = { inserts: [], updates: [], unchanged: [], warnings: [] };
    const claimed = new Set();
    for (const event of events) {
        const matches = existingRows.filter(row => !claimed.has(row.id) && matchesExistingRow(event, row));
        if (matches.length === 0) {
            plan.inserts.push(toRow(event));
            continue;
        }
        const target = matches[0]; // lowest id = the oldest row for this event
        claimed.add(target.id);
        if (matches.length > 1) {
            plan.warnings.push(`Rows ${matches.map(m => m.id).join(', ')} all look like "${event.details}". Updating ${target.id}; consider deleting the others.`);
        }
        const row = toRow(event);
        const changed = Object.keys(row).some(key => (row[key] ?? null) !== (target[key] ?? null));
        if (changed) plan.updates.push({ id: target.id, before: target, row });
        else plan.unchanged.push(target.id);
    }
    return plan;
}

module.exports = { sameEvent, completeness, mergeGroup, dedupeEvents, matchesExistingRow, planWrites, toRow };
