const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ChannelType } = require("discord.js");
const { Store } = require("../utils/store");
const { writeJson } = require("../utils/helpers");

const GUILD_A = "100000000000000001";
const GUILD_B = "100000000000000002";
const CHANNEL_A = "200000000000000001";
const CHANNEL_B = "200000000000000002";
const quiet = { info() {}, warn() {}, error() {} };
const config = { firstRunMode: "backfill", historyLimit: 1000, pollIntervalMs: 600000, newsSource: "rss" };

function directory(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "poe-bot-test-"));
    t.after(() => {
        if (path.resolve(path.dirname(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("poe-bot-test-")) {
            throw new Error("Refusing to clean an unexpected test directory.");
        }
        fs.rmSync(root, { recursive: true, force: true });
    });
    return root;
}

function article(id = "1", overrides = {}) {
    return { id: `url:https://www.pathofexile.com/forum/view-thread/${id}`,
        link: `https://www.pathofexile.com/forum/view-thread/${id}`, title: `News ${id}`,
        description: "A test announcement", publishedAt: "2026-01-01T00:00:00.000Z", category: "News", thumbnail: null,
        ...overrides };
}

function channel(guildId = GUILD_A, id = CHANNEL_A) {
    const sent = [];
    return { id, guildId, type: ChannelType.GuildText, sent,
        guild: { members: { me: {} } }, permissionsFor: () => ({ has: () => true }),
        async send(payload) { sent.push(payload); return { id: `${id}-${sent.length}` }; } };
}

function fixture(t, { guilds, legacyNews, legacyX, storeOptions } = {}) {
    const root = directory(t);
    writeJson(path.join(root, "guild_channels.json"), guilds || {
        [GUILD_A]: { channelId: CHANNEL_A, tag: "", xposts: true },
        [GUILD_B]: { channelId: CHANNEL_B, tag: "", xposts: true },
    });
    if (legacyNews) writeJson(path.join(root, "posted_news.json"), legacyNews);
    if (legacyX) writeJson(path.join(root, "posted_x_news.json"), legacyX);
    const store = new Store(root, { logger: quiet, ...storeOptions });
    const channels = { [CHANNEL_A]: channel(), [CHANNEL_B]: channel(GUILD_B, CHANNEL_B) };
    const client = { channels: { async fetch(id) {
        if (!channels[id]) throw new Error("Unknown channel");
        return channels[id];
    } } };
    return { root, store, channels, client };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

module.exports = { GUILD_A, GUILD_B, CHANNEL_A, CHANNEL_B, quiet, config, directory, article, channel, fixture, deferred };
