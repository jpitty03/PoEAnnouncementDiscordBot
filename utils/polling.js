function getCurrentPollInterval() {
    const now = new Date();
    const hour = now.getHours();

    // Check if time is between 22:00 (10 PM) and 05:00 (5 AM)
    if (hour >= 22 || hour < 5) {
        console.log(`🌙 Night time polling interval: 2 hours (${now.toLocaleTimeString()})`);
        return 2 * 60 * 60 * 1000; // 2 hours in milliseconds
    } else {
        console.log(`☀️ Day time polling interval: 10 minutes (${now.toLocaleTimeString()})`);
        return 10 * 60 * 1000; // 10 minutes in milliseconds
    }
}

function setupPolling(fetchAndPostNews) {
    let interval = getCurrentPollInterval();
    let timer = setInterval(async () => {
        await fetchAndPostNews();
        
        // Check if we need to change the interval
        const newInterval = getCurrentPollInterval();
        if (newInterval !== interval) {
            // Clear existing interval and set new one
            clearInterval(timer);
            interval = newInterval;
            // Pass fetchAndPostNews to the new interval
            timer = setInterval(async () => {
                await fetchAndPostNews();
            }, interval);
        }
    }, interval);
}

module.exports = {
    getCurrentPollInterval,
    setupPolling
};