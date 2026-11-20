// tests/cleaning.test.js
// Automated checks for the data-cleaning and deduplication rules.
// Run with:  npm test
//
// Each test feeds in a REAL messy value we've seen from Gemini or a promoter's
// site and states the clean value we expect. If someone later changes a rule
// and breaks an old case, the test fails and says exactly which value changed.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    cleanField, smartTitleCase, normalizeCity, normalizeState, normalizePromoter,
    normalizeTime, normalizeUrl, cleanInstagramEvent, cleanListingEvent, cleanWebEvent,
} = require('../utils/cleanEvents');
const { dedupeEvents, planWrites } = require('../utils/dedupeEvents');

const TODAY = new Date(2026, 10, 17); // 17 Nov 2026 (months count from 0)

test('placeholders become empty values', () => {
    for (const value of ['TBD', 'tba', 'N/A', 'Unknown', 'Location TBD', 'Upcoming Event', '  ']) {
        assert.equal(cleanField(value), '', value);
    }
    assert.equal(cleanField('  Madison  Square Garden. '), 'Madison Square Garden');
});

test('capitalisation is made consistent', () => {
    assert.equal(smartTitleCase('Madison SQUARE GARDEN'), 'Madison Square Garden');
    assert.equal(smartTitleCase('WARRIORS SERIES IV'), 'Warriors Series IV');
    assert.equal(smartTitleCase("LION'S ROAR MUAY THAI ACADEMY"), "Lion's Roar Muay Thai Academy");
    assert.equal(smartTitleCase('MUAY THAI MADNESS 24 – RUMBLE IN THE BRONX'), 'Muay Thai Madness 24 – Rumble in the Bronx');
    assert.equal(smartTitleCase('NYC'), 'NYC');           // acronyms stay
    assert.equal(smartTitleCase('McDonald'), 'McDonald'); // deliberate mixed case stays
});

test('places use one standard spelling', () => {
    assert.equal(normalizeCity('The Bronx'), 'Bronx');
    assert.equal(normalizeCity('NYC'), 'New York');
    assert.equal(normalizeCity('TBD'), '');
    assert.equal(normalizeState('New York'), 'NY');
    assert.equal(normalizeState('nj'), 'NJ');
});

test('promoter names are mapped to one standard name', () => {
    assert.equal(normalizePromoter('ThreePillarPromotions and rfc.promotions'), 'Three Pillar Promotions & RFC Promotions');
    assert.equal(normalizePromoter('3 KINGS PROMOTIONS'), '3 Kings Promotions');
    // An Instagram handle: "_" counts as a space when comparing, so it matches the alias table.
    assert.equal(normalizePromoter('@3kings_promotions'), '3 Kings Promotions');
    assert.equal(normalizePromoter('Brand New Promo'), 'Brand New Promo'); // unknown name: kept, not guessed
    assert.equal(normalizePromoter(''), '');
});

test('times use one format', () => {
    assert.equal(normalizeTime('6PM'), '6:00 PM');
    assert.equal(normalizeTime('Doors 5:30p.m.'), '5:30 PM');
    assert.equal(normalizeTime('4:00 pm'), '4:00 PM');
    assert.equal(normalizeTime('TBD'), '');
    assert.equal(normalizeTime('25pm'), '');
});

test('links must point at a specific page', () => {
    assert.equal(normalizeUrl('www.ticketmaster.com'), '');  // bare homepage: not useful
    assert.equal(normalizeUrl('tickets.freedomfighterpromotions.com/events/freedom-43'),
        'https://tickets.freedomfighterpromotions.com/events/freedom-43');
    assert.equal(normalizeUrl('POST_LINK'), '');
});

// --- Real cases from the 2026-11-17 run ------------------------------------

const post = (shortCode, type = 'Video') => ({ shortCode, type, url: `https://www.instagram.com/p/${shortCode}/` });
const ai = fields => ({ isEvent: true, eventName: '', promoter: '', date: '', time: '', venue: '', city: '', state: '', ticketUrl: '', ...fields });

const warriorsFlyer = cleanInstagramEvent(ai({
    eventName: 'WARRIORS SERIES IV', promoter: 'ThreePillarPromotions and rfc.promotions',
    date: 'Saturday December 12 2026', venue: 'Infosys Theater at Madison SQUARE GARDEN', city: 'NYC', state: 'New York',
    ticketUrl: 'www.ticketmaster.com',
}), { defaultPromotion: 'Diamond Fights Ice Breaker', post: post('Dfx57jON22R', 'Image'), today: TODAY });

const littleMikey = cleanInstagramEvent(ai({
    eventName: 'Little Mikey Championship Fight', date: 'DECEMBER 12TH', venue: 'MADISON SQUARE GARDEN', time: 'TBD',
}), { defaultPromotion: '3 Kings Promotions', post: post('DfSUy0muYHf'), today: TODAY });

const madnessA = cleanInstagramEvent(ai({ eventName: 'Muay Thai Madness 25', promoter: '3 KINGS PROMOTIONS', date: 'January 23, 2027', city: 'The Bronx', state: 'NY' }),
    { defaultPromotion: '3 Kings Promotions', post: post('DfyMv3Mpv9k'), today: TODAY });
const madnessB = cleanInstagramEvent(ai({ eventName: 'Muay Thai Madness 25', date: 'January 23', city: 'Bronx', time: 'TBD' }),
    { defaultPromotion: '3 Kings Promotions', post: post('DfyZi84trLK'), today: TODAY });
const nextEvent = cleanInstagramEvent(ai({ eventName: 'Upcoming Event', date: 'JANUARY,23RD' }),
    { defaultPromotion: '3 Kings Promotions', post: post('DfxHeN9JEr9'), today: TODAY });

test('an Instagram answer becomes one clean, standard record', () => {
    assert.equal(warriorsFlyer.details, 'Warriors Series IV - Infosys Theater at Madison Square Garden, New York, NY (December 12, 2026)');
    assert.equal(warriorsFlyer.promotion, 'Three Pillar Promotions & RFC Promotions'); // from the flyer, not the account
    assert.equal(warriorsFlyer.event_date, '2026-12-12');
    assert.equal(warriorsFlyer.url, 'https://www.instagram.com/p/Dfx57jON22R/'); // bare ticketmaster homepage rejected
    assert.equal(nextEvent.eventName, '');           // "Upcoming Event" is a placeholder, not a name
    assert.equal(nextEvent.event_date, '2027-01-23'); // year inferred: January after November
});

test('the same event posted by different accounts is merged into one', () => {
    const merged = dedupeEvents([warriorsFlyer, littleMikey, madnessA, madnessB, nextEvent]);
    assert.equal(merged.length, 2);

    const warriors = merged.find(e => e.event_date === '2026-12-12');
    assert.equal(warriors.details, warriorsFlyer.details); // the flyer is the most complete record
    assert.equal(warriors.promotion, 'Three Pillar Promotions & RFC Promotions');
    assert.equal(warriors.mergedFrom, 2);

    const madness = merged.find(e => e.event_date === '2027-01-23');
    assert.equal(madness.details, 'Muay Thai Madness 25 - Bronx, NY (January 23, 2027)');
    assert.equal(madness.mergedFrom, 3);
});

test('different events on the same night stay separate', () => {
    const other = cleanInstagramEvent(ai({ eventName: 'Garden State Showdown', promoter: 'Some Other Promotions', date: 'December 12 2026', venue: 'Newark Gym', state: 'NJ' }),
        { defaultPromotion: 'Somebody', post: post('X1', 'Image'), today: TODAY });
    assert.equal(dedupeEvents([warriorsFlyer, other]).length, 2);
});

test('events already in the table are updated, not inserted again', () => {
    const [madness] = dedupeEvents([madnessA, madnessB, nextEvent]);
    const existing = [
        { id: 39, promotion: '3 Kings Promotions', details: 'Muay Thai Madness 25 - The Bronx, NY (January 23. 2027)', url: 'https://www.instagram.com/p/DfyMv3Mpv9k/', event_date: '2027-01-23' },
    ];
    const plan = planWrites([madness, warriorsFlyer], existing);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].id, 39);
    assert.equal(plan.inserts.length, 1);
    assert.equal(plan.inserts[0].details, warriorsFlyer.details);
    assert.deepEqual(Object.keys(plan.inserts[0]).sort(), ['details', 'event_date', 'promotion', 'url']); // only real columns

    // Running again with the same data changes nothing.
    const again = planWrites([madness], [{ id: 39, ...plan.updates[0].row }]);
    assert.deepEqual(again.unchanged, [39]);
});

test('website text is tidied without being rewritten', () => {
    const wc = cleanWebEvent({ promotion: 'Warriors Cup', details: 'WARRIORS CUP 81 FRI, 10/23. 6PM LIC, NY.', url: 'https://example.com/wc81' }, { today: new Date(2026, 9, 1) });
    assert.equal(wc.details, 'Warriors Cup 81 Fri, 10/23. 6PM LIC, NY');
    assert.equal(wc.event_date, '2026-10-23');
});

test('an Eventbrite listing becomes one clean, standard record', () => {
    // Trimmed copy of the schema.org data on the real Battle in the Basement 23 page.
    const listing = {
        '@type': 'SocialEvent',
        name: 'Battle in the Basement 23',
        url: 'https://www.eventbrite.com/e/battle-in-the-basement-23-tickets-2003210212671',
        eventStatus: 'https://schema.org/EventScheduled',
        location: {
            '@type': 'Place', name: 'Church Street Boxing Gym',
            address: { addressLocality: 'New York', addressRegion: 'NY', streetAddress: '25 Park Place, New York, NY 10007' },
        },
        organizer: { name: 'Church Street Boxing Gym' },
        startDate: '2026-12-05T14:30:00-05:00',
    };
    const record = cleanListingEvent(listing, { defaultPromotion: 'Church Street Boxing Gym' });
    assert.equal(record.details, 'Battle in the Basement 23 - Church Street Boxing Gym, New York, NY (December 5, 2026, 2:30 PM)');
    assert.equal(record.event_date, '2026-12-05');   // read from the text, never shifted by timezone
    assert.equal(record.url, listing.url);
    assert.equal(record.hasTicketLink, true);

    // Morning and midnight starts use the 12-hour clock correctly.
    assert.equal(cleanListingEvent({ ...listing, startDate: '2026-12-05T09:05:00-05:00' }, {}).time, '9:05 AM');
    assert.equal(cleanListingEvent({ ...listing, startDate: '2026-12-05T00:00:00-05:00' }, {}).time, '12:00 AM');
});

test('the Three Pillar shows page and the flyer become one event', () => {
    // The real text block on threepillarpromotions.com/shows (no ticket button yet).
    const site = cleanWebEvent({
        promotion: 'Three Pillar Promotions',
        details: 'WARRIORS SERIES IV 12/12. 530PM NY, NY.',
        url: '',
        pageUrl: 'https://www.threepillarpromotions.com/shows',
    }, { today: TODAY });
    assert.equal(site.event_date, '2026-12-12');
    assert.equal(site.hasTicketLink, false);                                   // no button, so no ticket link
    assert.equal(site.url, 'https://www.threepillarpromotions.com/shows');     // falls back to the shows page

    const merged = dedupeEvents([warriorsFlyer, site]);
    assert.equal(merged.length, 1);                                // same date + same promoter = same event
    assert.equal(merged[0].details, warriorsFlyer.details);        // the more complete flyer wording wins
    assert.equal(merged[0].url, warriorsFlyer.url);                // and a missing ticket link never replaces a link

    // 'N/A' (what the old scraper sent) is not treated as a link either.
    assert.equal(cleanWebEvent({ promotion: 'X', details: 'Show 12/12', url: 'N/A' }, { today: TODAY }).hasTicketLink, false);
});

test("a ticket link from the promoter's site replaces the flyer's Instagram link", () => {
    const site = cleanWebEvent({
        promotion: 'Three Pillar Promotions',
        details: 'WARRIORS SERIES IV 12/12. 530PM NY, NY.',
        url: 'https://www.ticketmaster.com/event/3B0065568E6424E4',
        pageUrl: 'https://www.threepillarpromotions.com/shows',
    }, { today: TODAY });
    const [merged] = dedupeEvents([warriorsFlyer, site]);
    assert.equal(merged.url, 'https://www.ticketmaster.com/event/3B0065568E6424E4'); // the real ticket page wins
    assert.equal(merged.details, warriorsFlyer.details);                              // the flyer's wording stays
});
