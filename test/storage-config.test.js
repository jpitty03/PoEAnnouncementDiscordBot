const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lockfile = require("proper-lockfile");
const { readJson, writeJson, StorageError } = require("../utils/helpers");
const { Store } = require("../utils/store");
const { loadConfig, PROJECT_ROOT } = require("../utils/config");
const { directory, quiet, GUILD_A, CHANNEL_A } = require("./support");

test("JSON writes replace the file atomically and retain its previous version", t => {
    const root = directory(t);
    const file = path.join(root, "state.json");
    writeJson(file, { saved: 1 });
    writeJson(file, { saved: 2 });
    assert.deepEqual(readJson(file), { saved: 2 });
    assert.deepEqual(readJson(`${file}.bak`), { saved: 1 });
    assert.deepEqual(fs.readdirSync(root).sort(), ["state.json", "state.json.bak"]);
});

test("corrupt JSON, invalid schema and missing primary with a backup fail closed", t => {
    const root = directory(t);
    const file = path.join(root, "delivery_state.json");
    fs.writeFileSync(file, "{broken");
    assert.throws(() => new Store(root), StorageError);
    assert.equal(fs.readFileSync(file, "utf8"), "{broken");
    fs.writeFileSync(file, JSON.stringify({ version: 1, sources: [] }));
    assert.throws(() => new Store(root), StorageError);
    fs.renameSync(file, `${file}.bak`);
    assert.throws(() => new Store(root), /Cannot read/);
    assert.equal(fs.existsSync(file), false);
});

test("missing files initialize safely and malformed guild entries are preserved but ignored", t => {
    const root = directory(t);
    assert.deepEqual(new Store(root).getGuilds(), []);
    writeJson(path.join(root, "guild_channels.json"), {
        bad: { channelId: "test" }, [GUILD_A]: { channelId: CHANNEL_A, tag: "" },
    });
    const store = new Store(root, { logger: quiet });
    assert.equal(store.getGuilds().length, 1);
    store.updateGuild(GUILD_A, guild => ({ ...guild, tag: "news" }));
    assert.deepEqual(readJson(store.guildsFile).bad, { channelId: "test" });
});

test("failed configuration writes do not update memory or destroy the last saved file", t => {
    const root = directory(t);
    const store = new Store(root, { logger: quiet });
    store.updateGuild(GUILD_A, () => ({ channelId: CHANNEL_A, tag: "old" }));
    store.save = () => { throw new Error("Disk full"); };
    assert.throws(() => store.updateGuild(GUILD_A, guild => ({ ...guild, tag: "new" })), StorageError);
    assert.equal(store.getGuild(GUILD_A).tag, "old");
    assert.equal(readJson(store.guildsFile)[GUILD_A].tag, "old");
    assert.throws(() => store.checkpoint(), StorageError);
});

test("exclusive data-directory lock prevents a second instance and releases cleanly", async t => {
    const root = directory(t);
    const options = { lockfilePath: path.join(root, ".bot.lock"), stale: 30000, update: 10000 };
    const release = await lockfile.lock(root, options);
    try { await assert.rejects(lockfile.lock(root, options), { code: "ELOCKED" }); }
    finally { await release(); }
    const secondRelease = await lockfile.lock(root, options);
    await secondRelease();
});

test("configuration rejects missing credentials, unsafe URLs and invalid numeric settings", () => {
    assert.throws(() => loadConfig({}), /BOT_TOKEN/);
    for (const env of [{ POLL_INTERVAL_MS: "0" }, { HTTP_MAX_ATTEMPTS: "3.5" }, { NEWS_SOURCE: "other" },
        { RSS_FEED_URL: "file:///etc/passwd" }, { X_RSS_URL: "https://user:password@example.org" },
        { FIRST_RUN_MODE: "flood" }, { STEAM_APP_IDS: "1234" }]) {
        assert.throws(() => loadConfig(env, { requireToken: false }));
    }
    const config = loadConfig({ DATA_DIR: "data" }, { requireToken: false });
    assert.equal(config.dataDir, path.join(PROJECT_ROOT, "data"));
    assert.equal(config.firstRunMode, "baseline");
    assert.equal(config.xRssUrl, null);
});
