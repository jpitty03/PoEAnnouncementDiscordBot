const { loadPostedNews, savePostedNews, loadGuildChannels } = require("./helpers");
const xml2js = require("xml2js");

const JSON_X_FILE = "./posted_x_news.json";
const GUILD_CHANNELS_FILE = "./guild_channels.json";
const RSS_FEED_URL = "https://nitter.privacydev.net/pathofexile/rss";

const fetchXPosts = async (client) => {
    console.log("🔍 Checking for X posts...");

    // Load the current state of guild channels
    const guildChannels = loadGuildChannels(GUILD_CHANNELS_FILE);

    // If no guilds have been configured, do nothing
    if (Object.keys(guildChannels).length === 0) {
        console.log("ℹ️ No guilds configured for X posting.");
        return;
    }

    let postedXNews = loadPostedNews(JSON_X_FILE);
    if (!Array.isArray(postedXNews)) {
        postedXNews = [];
    }

    try {
        const response = await fetch(RSS_FEED_URL, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
                "Accept": "application/xml, text/xml"
            }
        });

        const text = await response.text();

        if (text.includes("<html") || text.includes("Cloudflare")) {
            console.error("❌ Cloudflare is blocking the request.");
            return;
        }

        // Parse the XML
        const parsedData = await xml2js.parseStringPromise(text);
        const items = parsedData.rss.channel[0].item;

        // Process each item
        for (const item of items) {
            // Extract the guid number
            const guidUrl = item.guid[0];
            const guidNumber = guidUrl.match(/status\/(\d+)/)?.[1];

            if (!guidNumber) continue;

            // Skip if we've already posted this
            if (postedXNews.includes(guidNumber)) continue;

            // Create the fixupx.com URL
            const fixupUrl = `https://fixupx.com/pathofexile/status/${guidNumber}`;

            // Send to all configured channels that have xposts enabled
            for (const [guildId, guildData] of Object.entries(guildChannels)) {
                // Skip if xposts is false or not set
                if (!guildData.xposts) continue;

                const channel = client.channels.cache.get(guildData.channelId);
                if (channel) {
                    try {
                        await channel.send(fixupUrl);
                        console.log(`✅ Posted X update to ${channel.guild.name}`);
                    } catch (error) {
                        console.error(`❌ Failed to post to ${channel.guild.name}:`, error);
                    }
                }
            }

            // Add to posted news
            postedXNews.push(guidNumber);
        }

        // Save updated posted news
        savePostedNews(JSON_X_FILE, postedXNews);

    } catch (error) {
        console.error("❌ Error fetching RSS feed:", error);
    }
};

module.exports = {
    fetchXPosts
};
