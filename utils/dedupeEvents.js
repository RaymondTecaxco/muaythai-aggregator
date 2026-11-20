// Merges records that describe the same event and matches them to rows
// already in Supabase.
//
// Two records are the same event if they share a date AND the promotion,
// venue or event name. Two different shows on the same night won't match
// on all three.

const { comparisonKey, buildDetails } = require('./cleanEvents');

// "Infosys Theater at Madison Square Garden" matches "Madison Square Garden"
function sameVenue(a, b) {
    const ka = comparisonKey(a);
    const kb = comparisonKey(b);
    if (!ka || !kb) return false;
    return ka.includes(kb) || kb.includes(ka);
}

function samePromotion(a, b) {
    // first promoter only, so co-promoted shows still match
    const first = p => comparisonKey(String(p).split(' & ')[0]);
    return Boolean(a && b) && first(a) === first(b);
}

function sameEvent(a, b) {
    if (!a.event_date || a.event_date !== b.event_date) return false; // never merge undated records
    return samePromotion(a.promotion, b.promotion)
        || sameVenue(a.venue, b.venue)
        || (Boolean(a.eventName) && comparisonKey(a.eventName) === comparisonKey(b.eventName));
}

// Decides which record in a group wins the merge.
function completeness(r) {
    return (r.eventName ? 3 : 0)
        + (r.promoterFromFlyer ? 2 : 0)   // printed on the flyer, not inferred from the account
        + (r.venue ? 2 : 0)
        + (r.city ? 1 : 0)
        + (r.time ? 1 : 0)
        + (r.hasTicketLink ? 1 : 0)
        + (['Image', 'Sidecar', 'Eventbrite'].includes(r.sourceType) ? 1 : 0);
}

const FILLABLE = ['eventName', 'venue', 'city', 'state', 'time'];

// Start from the most complete record and fill its gaps from the others.
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
    // website records keep their original text
    if (merged.sourceType !== 'Website') {
        const [y, m, d] = (merged.event_date || '').split('-').map(Number);
        merged.details = buildDetails({ ...merged, date: y ? new Date(y, m - 1, d) : null });
    }
    merged.mergedFrom = group.length;
    return merged;
}

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

// Stored rows only have promotion, details, url and event_date, so venue and
// name are matched against the details text instead.
function matchesExistingRow(event, row) {
    if (!event.event_date || event.event_date !== row.event_date) return false;
    const rowText = comparisonKey(row.details);
    return samePromotion(event.promotion, row.promotion)
        || (comparisonKey(event.venue).length > 0 && rowText.includes(comparisonKey(event.venue)))
        || (comparisonKey(event.eventName).length > 0 && rowText.includes(comparisonKey(event.eventName)))
        || comparisonKey(event.details) === rowText;
}

// The events table's columns; the other fields are only used for matching.
function toRow(event) {
    return {
        promotion: event.promotion,
        details: event.details,
        url: event.url,
        event_date: event.event_date,
    };
}

// Sorts each event into insert, update or unchanged.
function planWrites(events, existingRows) {
    const plan = { inserts: [], updates: [], unchanged: [], warnings: [] };
    const claimed = new Set();
    for (const event of events) {
        const matches = existingRows.filter(row => !claimed.has(row.id) && matchesExistingRow(event, row));
        if (matches.length === 0) {
            plan.inserts.push(toRow(event));
            continue;
        }
        const target = matches[0]; // oldest row (rows come back sorted by id)
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
