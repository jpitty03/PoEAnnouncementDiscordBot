require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fetch = require("node-fetch");
const fs = require("fs");
const xml2js = require("xml2js");

const RSS_FEED_URL = "https://www.pathofexile.com/news/rss";
const JSON_FILE = "posted_news.json";

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const loadPostedNews = () => {
    if (fs.existsSync(JSON_FILE)) {
        return JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));
    }
    return {};
};

const savePostedNews = (postedNews) => {
    fs.writeFileSync(JSON_FILE, JSON.stringify(postedNews, null, 4));
};

const fetchAndPostNews = async () => {
    console.log("🔍 Checking for new news...");
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) {
        console.error("❌ Error: Channel ID is incorrect or bot has no access!");
        return;
    }

    let postedNews = loadPostedNews();

    try {
        const response = await fetch(RSS_FEED_URL, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36", // User agent is required to bypass Cloudflare
                "Accept": "application/xml, text/xml"
            }
        });

        let text = await response.text();

        if (text.includes("<html") || text.includes("Cloudflare")) {
            console.error("❌ Cloudflare is blocking the request.");
            return;
        }

        text = text.replace(/&(?!(amp;|lt;|gt;|quot;|apos;))/g, "&amp;");

        const parsedData = await xml2js.parseStringPromise(text, { mergeAttrs: true });

        if (!parsedData.rss || !parsedData.rss.channel || !parsedData.rss.channel[0].item) {
            console.error("❌ Error: Unexpected RSS feed structure", parsedData);
            return;
        }

        const items = parsedData.rss.channel[0].item || [];
        const imageUrl = parsedData.rss.channel[0].image?.[0].url?.[0] || null;

        for (let item of items.reverse()) {
            const title = item.title?.[0] || "No Title";
            let description = item.description?.[0] || "No Description";
            const link = item.link?.[0] || "#";
            const pubDateRaw = item.pubDate?.[0];
            const category = item.category?.[0] || "General";

            if (pubDateRaw && !postedNews[pubDateRaw]) {
                // Format date from "Mon, 03 Feb 2025 01:51:51 +0000" → "Mon, 03 Feb 2025"
                const pubDateFormatted = pubDateRaw.split(" ").slice(0, 4).join(" ");

                // Remove "Read More" HTML links from the description
                description = description.replace(/<a href=".*?">Read More.<\/a>/g, "").trim();

                // Limit description length for Discord embeds
                if (description.length > 1000) {
                    description = description.substring(0, 1000) + "...";
                }

                // Create an embedded message
                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setURL(link)
                    .setDescription(`${description}\n\n[Read More](${link})`)
                    .addFields(
                        { name: "📅 Published", value: pubDateFormatted, inline: true },
                        { name: "📂 Category", value: category, inline: true }
                    )
                    .setColor("Red");

                // Attach image if available
                if (imageUrl) {
                    embed.setThumbnail(imageUrl);
                }

                await channel.send({ embeds: [embed] });

                postedNews[pubDateRaw] = { title, link };
                savePostedNews(postedNews);
            }
        }
    } catch (error) {
        console.error("❌ Error fetching RSS feed:", error);
    }
};



// Run news checker every 15 minutes
setInterval(fetchAndPostNews, 15 * 60 * 1000);

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
    fetchAndPostNews();
});

client.login(process.env.BOT_TOKEN);
