require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function isUpcoming(details) {
    // Drop dead links / 404 pages
    if (details.toLowerCase().includes('page not found')) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Look for date patterns like "Oct 3" or "10/3"
    const dateMatch = details.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}|\d{1,2}\/\d{1,2}/i);

    if (dateMatch) {
        const eventDate = new Date(`${dateMatch[0]} ${today.getFullYear()}`);
        if (!isNaN(eventDate) && eventDate < today) {
            return false; // Stale date, skip it
        }
    }
    return true;
}

async function formatForBeehiiv() {
    try {
        console.log("Fetching upcoming events from Supabase...\n");
        
        const { data: events, error } = await supabase
            .from('events')
            .select('*');

        if (error) throw error;

        // Filter out past fights and invalid pages
        const upcomingEvents = (events || []).filter(e => isUpcoming(e.details));

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