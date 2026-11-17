require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { toIsoDate } = require('./utils/cleanEvents');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Dead links and 404 pages scraped by mistake.
function isValid(details) {
    return !details.toLowerCase().includes('page not found');
}

async function formatForBeehiiv() {
    try {
        console.log("Fetching upcoming events from Supabase...\n");
        
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

        console.log("=== COPY AND PASTE THE BELOW INTO BEEHIIV ===\n");
        
        upcomingEvents.forEach(event => {
            console.log(`🥊 ${event.promotion}`);
            console.log(`${event.details}`);
            console.log(`🎟️ Tickets & Info: ${event.url}`);
            console.log(`\n--------------------------------------------\n`);
        });

        console.log("=== END OF DATA ===");

    } catch (error) {
        console.error("Error fetching data:", error.message);
    }
}

formatForBeehiiv();