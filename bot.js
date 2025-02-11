require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fetch = require("node-fetch");
const fs = require("fs");
const xml2js = require("xml2js");

// URL for the RSS feed
const RSS_FEED_URL = "https://www.pathofexile.com/news/rss";

const JSON_FILE = "posted_news.json";

const GUILD_CHANNELS_FILE = "guild_channels.json";

// Create the client with intents.
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

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

const loadPostedNews = () => loadJSON(JSON_FILE);
const savePostedNews = (postedNews) => saveJSON(JSON_FILE, postedNews);

const loadGuildChannels = () => loadJSON(GUILD_CHANNELS_FILE);
const saveGuildChannels = (guildChannels) => saveJSON(GUILD_CHANNELS_FILE, guildChannels);

// Load the guild channels mapping at startup
let guildChannels = loadGuildChannels();

// -----------------------
// Command to allow a guild admin to set the channel for news posts.
// For example, an admin can type: !setpoechannel #news
// -----------------------

client.on("messageCreate", (message) => {
    // Ignore messages from bots.
    if (message.author.bot) return;

    // Only allow administrators to use commands.
    if (!message.member.permissions.has("Administrator")) return;

    // Split the message content into arguments.
    const args = message.content.trim().split(/\s+/);
    const command = args[0].toLowerCase();

    // Help command.
    if (command === "!poenewshelp") {
        return message.reply(
            "**Available Commands (Admins Only):**\n" +
            "`!setpoechannel #channel` - Set the Path of Exile Announcements channel.\n" +
            "`!poenewshelp` - Display this help message."
        );
    }

    // Set channel command.
    if (command === "!setpoechannel") {
        // Get the first mentioned channel.
        const channel = message.mentions.channels.first();
        if (!channel) {
            return message.reply("❌ Please mention a text channel to set as the news channel. Example: `!setpoechannel #news`");
        }

        // Save the channel ID for this guild.
        guildChannels[message.guild.id] = channel.id;
        saveGuildChannels(guildChannels);

        return message.reply(`✅ Path of Exile Announcements channel set to ${channel}.`);
    }
});


// -----------------------
// Function to fetch and post news.
// Loop over all guilds that have configured a channel.
// -----------------------

const fetchAndPostNews = async () => {
    console.log("🔍 Checking for new news...");

    // If no guilds have been configured, do nothing.
    if (Object.keys(guildChannels).length === 0) {
        console.log("ℹ️ No guilds configured for news posting.");
        return;
    }

    let postedNews = loadPostedNews();

    try {
        // Fetch the RSS feed
        const response = await fetch(RSS_FEED_URL, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
                "Accept": "application/xml, text/xml"
            }
        });

        let text = await response.text();

        // Handle possible Cloudflare blocks
        if (text.includes("<html") || text.includes("Cloudflare")) {
            console.error("❌ Cloudflare is blocking the request.");
            return;
        }

        // Fix for potential unescaped ampersands
        text = text.replace(/&(?!(amp;|lt;|gt;|quot;|apos;))/g, "&amp;");

        // Parse the XML
        const parsedData = await xml2js.parseStringPromise(text, { mergeAttrs: true });
        if (!parsedData.rss || !parsedData.rss.channel || !parsedData.rss.channel[0].item) {
            console.error("❌ Error: Unexpected RSS feed structure", parsedData);
            return;
        }

        const items = parsedData.rss.channel[0].item || [];
        const imageUrl = parsedData.rss.channel[0].image?.[0].url?.[0] || null;

        // Reverse the list so that older news is processed first.
        for (let item of items.reverse()) {
            const title = item.title?.[0] || "No Title";
            let description = item.description?.[0] || "No Description";
            const link = item.link?.[0] || "#";
            const pubDateRaw = item.pubDate?.[0];
            const category = item.category?.[0] || "General";

            // Use the publication date as a unique key for this news item.
            if (pubDateRaw && !postedNews[pubDateRaw]) {
                // Format the date (e.g. "Mon, 03 Feb 2025")
                const pubDateFormatted = pubDateRaw.split(" ").slice(0, 4).join(" ");

                // Remove "Read More" links from the description
                description = description.replace(/<a href=".*?">Read More.<\/a>/g, "").trim();

                // Convert any remaining HTML anchor tags to Markdown links.
                // This will transform something like:
                // <a href="https://example.com">Example</a>
                // into:
                // [Example](https://example.com)
                description = description.replace(/<a\s+href="([^"]+)"\s*>(.*?)<\/a>/gi, "[$2]($1)");

                // Shorten description if it’s too long for Discord embeds.
                if (description.length > 1000) {
                    description = description.substring(0, 1000) + "...";
                }

                // Create the embed message
                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setURL(link)
                    .setDescription(`${description}\n\n[Read More](${link})`)
                    .addFields(
                        { name: "📅 Published", value: pubDateFormatted, inline: true },
                        { name: "📂 Category", value: category, inline: true }
                    )
                    .setColor("Red");

                // If an image is available, add it as a thumbnail.
                if (imageUrl) {
                    embed.setThumbnail(imageUrl);
                }

                // Loop over each guild that has set a news channel and send the embed.
                for (let guildId in guildChannels) {
                    const channelId = guildChannels[guildId];
                    const channel = client.channels.cache.get(channelId);
                    if (channel) {
                        try {
                            await channel.send({ embeds: [embed] });
                        } catch (err) {
                            console.error(`❌ Could not send message to channel ${channelId} in guild ${guildId}:`, err);
                        }
                    } else {
                        console.error(`❌ Channel ${channelId} not found for guild ${guildId}.`);
                    }
                }

                // Mark this news item as posted (global across all guilds)
                postedNews[pubDateRaw] = { title, link };
                savePostedNews(postedNews);
            }
        }
    } catch (error) {
        console.error("❌ Error fetching RSS feed:", error);
    }
};

// -----------------------
// Set up the periodic news check and login
// -----------------------

// Check for new news every 15 minutes.
setInterval(fetchAndPostNews, 15 * 60 * 1000);

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
    fetchAndPostNews();
});

client.login(process.env.BOT_TOKEN);
