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
// Helper function for safe replies.
// This wraps message.reply in a try/catch block and notifies the guild owner if sending fails.
// -----------------------
async function safeReply(message, content) {
    try {
        await message.reply(content);
    } catch (err) {
        console.error("Error replying to command:", err);
        try {
            const guild = message.guild;
            if (guild) {
                const owner = await guild.fetchOwner();
                await owner.send(
                    `Hello! I encountered an error while replying to a command in <#${message.channel.id}>. The error was: \`${err.message}\`. Please check that I have permission to send messages in that channel.`
                );
            }
        } catch (notifyErr) {
            console.error("Error notifying the guild owner:", notifyErr);
        }
    }
}

// -----------------------
// Command handler (Admins Only)
// -----------------------
client.on("messageCreate", async (message) => {
    // Ignore messages from bots.
    if (message.author.bot) return;

    // Only allow administrators to use commands.
    if (!message.member.permissions.has("Administrator")) return;

    // Split the message content into arguments.
    const args = message.content.trim().split(/\s+/);
    const command = args[0].toLowerCase();

    // Help command.
    if (command === "!poenewshelp") {
        return safeReply(
            message,
            "**Available Admin Commands:**\n" +
                "`!setpoechannel #channel` - Set the channel for Path of Exile Announcements.\n" +
                "`!setpoetag <tag>` - Set a custom tag (e.g., @PoE-1) to be included with announcements.\n" +
                "`!poenewshelp` - Display this help message."
        );
    }

    // Set announcements channel command.
    if (command === "!setpoechannel") {
        // Get the first mentioned channel.
        const channel = message.mentions.channels.first();
        if (!channel) {
            return safeReply(
                message,
                "❌ Please mention a text channel to set as the announcements channel. Example: `!setpoechannel #news`"
            );
        }

        // Create or update the configuration for this guild.
        if (!guildChannels[message.guild.id]) {
            guildChannels[message.guild.id] = { channelId: channel.id, tag: "" };
        } else {
            guildChannels[message.guild.id].channelId = channel.id;
        }
        saveGuildChannels(guildChannels);

        return safeReply(
            message,
            `✅ Path of Exile Announcements channel set to ${channel}.`
        );
    }

    // Set custom tag command.
    if (command === "!setpoetag") {
        // Get the tag from the command arguments.
        const tag = args.slice(1).join(" ");
        if (!tag) {
            return safeReply(
                message,
                "❌ Please provide a tag. Usage: `!setpoetag @PoE-1`"
            );
        }

        // Ensure the announcements channel has been set first.
        if (!guildChannels[message.guild.id] || !guildChannels[message.guild.id].channelId) {
            return safeReply(
                message,
                "❌ Please set the announcements channel first using `!setpoechannel #channel`."
            );
        }

        // Update the tag for this guild.
        guildChannels[message.guild.id].tag = tag;
        saveGuildChannels(guildChannels);

        return safeReply(
            message,
            `✅ Custom tag set to: ${tag}`
        );
    }
});

// -----------------------
// Function to fetch and post news.
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
        // Fetch the RSS feed.
        const response = await fetch(RSS_FEED_URL, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
                "Accept": "application/xml, text/xml"
            }
        });

        let text = await response.text();

        // Handle possible Cloudflare blocks.
        if (text.includes("<html") || text.includes("Cloudflare")) {
            console.error("❌ Cloudflare is blocking the request.");
            return;
        }

        // Fix for potential unescaped ampersands.
        text = text.replace(/&(?!(amp;|lt;|gt;|quot;|apos;))/g, "&amp;");

        // Parse the XML.
        const parsedData = await xml2js.parseStringPromise(text, { mergeAttrs: true });
        if (!parsedData.rss || !parsedData.rss.channel || !parsedData.rss.channel[0].item) {
            console.error("❌ Error: Unexpected RSS feed structure", parsedData);
            return;
        }

        const items = parsedData.rss.channel[0].item || [];
        const imageUrl = parsedData.rss.channel[0].image?.[0].url?.[0] || null;

        // Process older news first.
        for (let item of items.reverse()) {
            const title = item.title?.[0] || "No Title";
            let description = item.description?.[0] || "No Description";
            const link = item.link?.[0] || "#";
            const pubDateRaw = item.pubDate?.[0];
            const category = item.category?.[0] || "General";

            // Use the publication date as a unique key.
            if (pubDateRaw && !postedNews[pubDateRaw]) {
                const pubDateFormatted = pubDateRaw.split(" ").slice(0, 4).join(" ");

                // Clean and format description.
                description = description.replace(/<a href=".*?">Read More.<\/a>/g, "").trim();
                description = description.replace(/<a\s+href="([^"]+)"\s*>(.*?)<\/a>/gi, "[$2]($1)");
                if (description.length > 1000) {
                    description = description.substring(0, 1000) + "...";
                }

                // Create the embed message.
                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setURL(link)
                    .setDescription(`${description}\n\n[Read More](${link})`)
                    .addFields(
                        { name: "📅 Published", value: pubDateFormatted, inline: true },
                        { name: "📂 Category", value: category, inline: true }
                    )
                    .setColor("Red");

                if (imageUrl) {
                    embed.setThumbnail(imageUrl);
                }

                // Loop over each configured guild.
                for (let guildId in guildChannels) {
                    const config = guildChannels[guildId];
                    const channel = client.channels.cache.get(config.channelId);
                    if (channel) {
                        try {
                            if (config.tag && config.tag.trim() !== "") {
                                await channel.send({ content: config.tag, embeds: [embed] });
                            } else {
                                await channel.send({ embeds: [embed] });
                            }
                        } catch (err) {
                            console.error(`❌ Could not send message to channel ${config.channelId} in guild ${guildId}:`, err);
                            try {
                                const guild = client.guilds.cache.get(guildId);
                                if (guild) {
                                    const owner = await guild.fetchOwner();
                                    await owner.send(
                                        `Hello! I encountered an error while trying to send an announcement to <#${config.channelId}> in your server. The error was: \`${err.message}\`. Please check my channel permissions.`
                                    );
                                }
                            } catch (notifyErr) {
                                console.error(`❌ Could not notify the owner of guild ${guildId}:`, notifyErr);
                            }
                        }
                    } else {
                        console.error(`❌ Channel ${config.channelId} not found for guild ${guildId}.`);
                    }
                }

                // Mark this news item as posted (global across all guilds).
                postedNews[pubDateRaw] = { title, link };
                savePostedNews(postedNews);
            }
        }
    } catch (error) {
        console.error("❌ Error fetching RSS feed:", error);
    }
};

// -----------------------
// Set up the periodic news check and login.
// -----------------------
setInterval(fetchAndPostNews, 15 * 60 * 1000);

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
    fetchAndPostNews();
});

client.login(process.env.BOT_TOKEN);
