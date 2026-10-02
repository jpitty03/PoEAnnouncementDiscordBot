const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function integer(env, name, fallback, min, max) {
    const value = env[name]?.trim() || String(fallback);
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}.`);
    }
    return number;
}

function httpUrl(value, name) {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
        return url.href;
    } catch {
        throw new Error(`${name} must be an absolute HTTP(S) URL without embedded credentials.`);
    }
}

function loadConfig(env = process.env, { requireToken = true } = {}) {
    const token = env.BOT_TOKEN?.trim();
    if (requireToken && (!token || token === "your_discord_bot_token")) {
        throw new Error("Set BOT_TOKEN in the project's .env file before starting the bot.");
    }
    const newsSource = env.NEWS_SOURCE?.trim().toLowerCase() || "rss";
    if (!["rss", "steam"].includes(newsSource)) throw new Error("NEWS_SOURCE must be rss or steam.");
    const firstRunMode = env.FIRST_RUN_MODE?.trim().toLowerCase() || "baseline";
    if (!["baseline", "backfill"].includes(firstRunMode)) {
        throw new Error("FIRST_RUN_MODE must be baseline or backfill.");
    }
    const steamAppIds = [...new Set((env.STEAM_APP_IDS || "238960").split(",").map(id => id.trim()))];
    if (!steamAppIds.length || steamAppIds.some(id => !["238960", "2694490"].includes(id))) {
        throw new Error("STEAM_APP_IDS must contain 238960 (PoE 1), 2694490 (PoE 2), or both separated by a comma.");
    }
    return {
        token, newsSource, firstRunMode, steamAppIds,
        dataDir: path.resolve(PROJECT_ROOT, env.DATA_DIR?.trim() || "."),
        rssUrl: httpUrl(env.RSS_FEED_URL?.trim() || "https://www.pathofexile.com/news/rss", "RSS_FEED_URL"),
        xRssUrl: env.X_RSS_URL?.trim() ? httpUrl(env.X_RSS_URL.trim(), "X_RSS_URL") : null,
        pollIntervalMs: integer(env, "POLL_INTERVAL_MS", 600000, 1000, 86400000),
        httpTimeoutMs: integer(env, "HTTP_TIMEOUT_MS", 30000, 1, 120000),
        httpMaxAttempts: integer(env, "HTTP_MAX_ATTEMPTS", 3, 1, 10),
        httpMaxBytes: integer(env, "HTTP_MAX_BYTES", 2097152, 1024, 10485760),
        historyLimit: integer(env, "HISTORY_LIMIT", 1000, 1, 100000),
    };
}

module.exports = { PROJECT_ROOT, loadConfig, httpUrl };
