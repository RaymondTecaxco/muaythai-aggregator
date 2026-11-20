-- Upcoming events only. Run once in the Supabase SQL editor.
-- The events table keeps full history; the site and newsletter read this view.

create or replace view upcoming_events
with (security_invoker = true) as
select *
from events
-- New York date, not UTC, so an event doesn't drop off at 7 pm on fight night
where event_date >= (now() at time zone 'America/New_York')::date
   -- keep events whose date couldn't be parsed
   or event_date is null
order by event_date nulls last;

grant select on upcoming_events to anon, authenticated;
