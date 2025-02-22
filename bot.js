require("dotenv").config();
const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const fetch = require("node-fetch");
const xml2js = require("xml2js");
const { setupPolling } = require("./utils/polling");
const { fetchXPosts } = require("./utils/getXPosts");
const { loadPostedNews, savePostedNews, loadGuildChannels, saveGuildChannels } = require("./utils/helpers")

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
// Helper function for safe replies.
// This wraps message.reply in a try/catch block and notifies the guild owner if sending fails.
// -----------------------
async function safeReply(message, content) {
    try {
        await message.reply(content);
    } catch (err) {
        console.error("Error replying to command:", err);
        try {
            // Send a DM to the command issuer with the detailed error message.
            await message.author.send(
                `I encountered an error while processing your command in <#${message.channel.id}>.\n\nError details: \`${err.message}\``
            );
        } catch (dmErr) {
            console.error("Error DMing the command issuer:", dmErr);
        }
    }
}

// -----------------------
// Command handler (Mods Only)
// -----------------------
client.on("messageCreate", async (message) => {
    let guildChannels = loadGuildChannels(GUILD_CHANNELS_FILE);

    // Ignore messages from bots.
    if (message.author.bot) return;

    // Only allow mods to use commands.
    if (
        !message.member.permissions.has(PermissionFlagsBits.Administrator) &&
        !message.member.permissions.has(PermissionFlagsBits.ManageChannels) &&
        !message.member.permissions.has(PermissionFlagsBits.ManageMessages) &&
        !message.member.permissions.has(PermissionFlagsBits.KickMembers)
    ) {
        return;
    }

    // Split the message content into arguments.
    const args = message.content.trim().split(/\s+/);
    const command = args[0].toLowerCase();

    // Help command.
    if (command === "!poenewshelp") {
        return safeReply(
            message,
            "**Available Mod Commands:**\n" +
            "`!setpoechannel #channel` - Set the channel for Path of Exile Announcements.\n" +
            "`!setpoetag <tag>` - Set a custom tag (e.g., @PoE-1) to be included with announcements.\n" +
            "`!togglex` - Enable/Disable Path of Exile Twitter/X Posts.\n" +
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
        saveGuildChannels(GUILD_CHANNELS_FILE, guildChannels);

        console.log(
            `
            Username: ${message.author.username} 
            GlobalName: ${message.author.globalName}
            -------------------------------------
            Subscribed to bot.
            Server: '${channel.guild.name} (${channel.guildId})'
            Channel: '${channel.name} (${channel})'
            ------------------------------------
            `);

        return safeReply(
            message,
            `✅ Path of Exile Announcements channel set to ${channel}.`
        );
    }

    // Set announcements channel command.
    if (command === "!togglex") {
        let guildChannels = loadGuildChannels(GUILD_CHANNELS_FILE);

        // Check if guild is configured
        if (!guildChannels[message.guild.id]) {
            return safeReply(
                message,
                "❌ This server hasn't set up an announcements channel yet. Use `!setpoechannel #channel` first."
            );
        }

        // If xposts doesn't exist, add it as true
        if (!('xposts' in guildChannels[message.guild.id])) {
            guildChannels[message.guild.id].xposts = true;
            saveGuildChannels(GUILD_CHANNELS_FILE, guildChannels);
            return safeReply(
                message,
                "✅ X/Twitter posts have been enabled for this server."
            );
        }

        // Toggle existing xposts value
        guildChannels[message.guild.id].xposts = !guildChannels[message.guild.id].xposts;
        saveGuildChannels(GUILD_CHANNELS_FILE, guildChannels);

        return safeReply(
            message,
            `✅ X/Twitter posts have been ${guildChannels[message.guild.id].xposts ? 'enabled' : 'disabled'} for this server.`
        );
    }

    // Set custom tag command.
    if (command === "!setpoetag") {
        guildChannels = loadGuildChannels(GUILD_CHANNELS_FILE);

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
        saveGuildChannels(GUILD_CHANNELS_FILE, guildChannels);

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

    // Load the current state of guild channels at the start of each check
    const guildChannels = loadGuildChannels(GUILD_CHANNELS_FILE);

    // If no guilds have been configured, do nothing.
    if (Object.keys(guildChannels).length === 0) {
        console.log("ℹ️ No guilds configured for news posting.");
        return;
    }

    let postedNews = loadPostedNews(JSON_FILE);

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
                savePostedNews(JSON_FILE, postedNews);
            }
        }

        // Fetch Path of Exile Twitter/X Posts and message discord if Twitter/X is enabled.
        fetchXPosts(client);
    } catch (error) {
        console.error("❌ Error fetching RSS feed:", error);
    }
};

// -----------------------
// Set up the periodic news check and login.
// -----------------------
client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
    fetchAndPostNews();
    setupPolling(fetchAndPostNews);
});

// eslint-disable-next-line no-undef
client.login(process.env.BOT_TOKEN);
