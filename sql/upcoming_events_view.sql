-- sql/upcoming_events_view.sql
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- A VIEW is a saved query that behaves like a read-only table. The `events`
-- table keeps every event ever scraped (history for analytics, and stable ids
-- for the planned coach matchmaker); the view shows only the ones still to come.
-- The website and newsletter read `upcoming_events` instead of `events`.

create or replace view upcoming_events
-- Apply the same access rules (row level security) as the events table,
-- instead of the view owner's. Supabase recommends this for every view.
with (security_invoker = true) as
select *
from events
-- "Today" in New York, not UTC: plain current_date would roll over at 7 pm
-- Eastern and hide an event during its own fight night.
where event_date >= (now() at time zone 'America/New_York')::date
   -- keep events whose date we couldn't read, rather than silently hiding them
   or event_date is null
order by event_date nulls last;

-- Let the website's public (anon) key read the view, like it reads the table.
grant select on upcoming_events to anon, authenticated;
