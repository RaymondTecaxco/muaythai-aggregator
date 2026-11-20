const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNewsletter, monthLabel } = require('../beehiiv-formatter');

const events = [
    { promotion: 'Battle in the Basement', event_date: '2026-12-05',
      details: 'Battle in the Basement 23 - Church Street Boxing Gym, New York, NY (December 5, 2026, 2:30 PM)',
      url: 'https://www.eventbrite.com/e/battle-in-the-basement-23-tickets-2003210212671' },
    { promotion: 'Three Pillar Promotions & RFC Promotions', event_date: '2026-12-12',
      details: 'Warriors Series IV - Infosys Theater at Madison Square Garden, New York, NY (December 12, 2026)',
      url: 'https://www.instagram.com/p/Dfx57jON22R/' },
    { promotion: '3 Kings Promotions', event_date: '2027-01-23',
      details: "Muay Thai Madness 25 - John's Boxing Gym, Bronx, NY (January 23, 2027, 4:00 PM)",
      url: 'https://www.instagram.com/p/Df2gtKUO7L9/' },
    { promotion: 'Freedom Fighter Promotions', event_date: null, details: 'Freedom 43',
      url: 'https://tickets.freedomfighterpromotions.com/events/freedom-43' },
];

test('events are grouped under month headings, in date order', () => {
    const { html } = buildNewsletter(events);
    const headings = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map(m => m[1]);
    assert.deepEqual(headings, ['December 2026', 'January 2027', 'Date to be announced']);
    assert.equal(monthLabel('2026-12-05'), 'December 2026');
});

test('links are clickable and say what the reader gets', () => {
    const { html, text } = buildNewsletter(events);
    assert.match(html, /<a href="https:\/\/www\.eventbrite\.com\/e\/battle-in-the-basement-23-tickets-2003210212671">🎟️ Tickets &amp; Info<\/a>/);
    assert.match(html, /<a href="https:\/\/www\.instagram\.com\/p\/Df2gtKUO7L9\/">📸 See the flyer<\/a>/);
    assert.match(text, /📸 See the flyer: https:\/\/www\.instagram\.com\/p\/Df2gtKUO7L9\//);
});

test('special characters are escaped for HTML but not in plain text', () => {
    const { html, text } = buildNewsletter(events);
    assert.match(html, /Three Pillar Promotions &amp; RFC Promotions/);
    assert.match(html, /John's Boxing Gym/);
    assert.match(text, /Three Pillar Promotions & RFC Promotions/);
    assert.doesNotMatch(html, /<script/i);
    const sneaky = buildNewsletter([{ promotion: 'X', event_date: null, details: '<script>alert(1)</script>', url: '' }]);
    assert.match(sneaky.html, /&lt;script&gt;/);   // shown as text, never run
});
