function formatAndFilterEvents(events) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const processedEvents = [];

    events.forEach(event => {
        // EXPLANATION: Safely grab the text to search. 
        // Web scrapers use 'event.details', Apify scrapers use 'event.caption'.
        const textToSearch = event.details || event.caption || "";

        // Regex looks for "Oct 24" or "10/24" anywhere in the text
        const dateMatch = textToSearch.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}|\d{1,2}\/\d{1,2}/i);
        
        if (dateMatch) {
            // Convert it into a mathematical JS Date object
            const eventDate = new Date(`${dateMatch[0]} ${today.getFullYear()}`);
            
            if (!isNaN(eventDate)) {
                // If the date is in the past, skip it completely
                if (eventDate < today) {
                    console.log(`[FILTERED] Dropping past event: ${textToSearch.substring(0, 30)}...`);
                    return; 
                }
                
                // If it's upcoming, standardise the date format for PostgreSQL (YYYY-MM-DD)
                const isoDate = new Date(eventDate.getTime() + (12 * 60 * 60 * 1000)).toISOString().split('T')[0];
                
                // Attach the clean date to the event object
                event.event_date = isoDate;
            }
        }
        
        // If we made it here, the event is valid. Push it to the final array.
        processedEvents.push(event);
    });

    return processedEvents;
}

module.exports = formatAndFilterEvents;