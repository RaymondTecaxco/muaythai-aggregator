function filterPastEvents(events) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events.filter(event => {
        const dateMatch = event.details.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}|\d{1,2}\/\d{1,2}/i);
        if (dateMatch) {
            const eventDate = new Date(`${dateMatch[0]} ${today.getFullYear()}`);
            if (!isNaN(eventDate) && eventDate < today) {
                return false;
            }
        }
        return true;
    });
}

module.exports = filterPastEvents;