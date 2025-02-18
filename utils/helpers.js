const fs = require('fs');

// -----------------------
// Utility functions to load and save JSON data
// -----------------------
const loadJSON = (filename) => {
    if (fs.existsSync(filename)) {
        return JSON.parse(fs.readFileSync(filename, "utf8"));
    }
    return {};
};

const saveJSON = (filename, data) => {
    fs.writeFileSync(filename, JSON.stringify(data, null, 4));
};

const loadPostedNews = (JSON_FILE) => loadJSON(JSON_FILE);
const savePostedNews = (JSON_FILE, postedNews) => saveJSON(JSON_FILE, postedNews);

const loadGuildChannels = (GUILD_CHANNELS_FILE) => loadJSON(GUILD_CHANNELS_FILE);
const saveGuildChannels = (GUILD_CHANNELS_FILE, guildChannels) => saveJSON(GUILD_CHANNELS_FILE, guildChannels);


module.exports = {
    loadPostedNews,
    savePostedNews,
    loadGuildChannels,
    saveGuildChannels
}