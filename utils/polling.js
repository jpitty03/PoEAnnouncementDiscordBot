function setupPolling(fetchAndPostNews) {
    // Check interval every minute
    setInterval(() => {
        const now = new Date();
        const minutes = now.getMinutes();
        const hours = now.getHours();

        // During day time (5 AM - 10 PM), run every 10 minutes
        if (hours >= 5 && hours < 22) {
            if (minutes % 10 === 0) {
                console.log(`☀️ Day time check: ${now.toLocaleTimeString()}`);
                fetchAndPostNews();
            }
        }
        // During night time (10 PM - 5 AM), run every 2 hours
        else {
            if (minutes === 0 && hours % 2 === 0) {
                console.log(`🌙 Night time check: ${now.toLocaleTimeString()}`);
                fetchAndPostNews();
            }
        }
    }, 60 * 1000); // Check every minute
}

module.exports = {
    setupPolling
};
