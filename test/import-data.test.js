const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lockfile = require("proper-lockfile");
const { importData } = require("../scripts/import-data");
const { Store } = require("../utils/store");
const { writeJson } = require("../utils/helpers");
const { fixture, directory, article, GUILD_A, CHANNEL_A, quiet } = require("./support");

test("data import preserves subscriptions, acknowledgements, legacy history and backups without copying secrets", async t => {
    const { root, store } = fixture(t, {
        legacyNews: { old: { link: article("old").link } }, legacyX: ["12345"],
    });
    const news = article();
    const source = store.source("rss");
    source.initialized = true;
    source.items[news.id] = { article: news, discoveredAt: "2026-01-01T00:00:00.000Z", deliveries: {
        [GUILD_A]: { status: "sent", subscription: null, channelId: CHANNEL_A,
            messageId: "saved-message", sentAt: "2026-01-01T00:01:00.000Z" },
    } };
    store.checkpoint();
    store.checkpoint(); // Keep an existing backup too.
    fs.writeFileSync(path.join(root, ".env"), "BOT_TOKEN=secret-not-for-the-data-volume");
    const target = path.join(directory(t), "state");
    const imported = await importData(root, target, { logger: quiet });
    assert.equal(imported.length, 5);
    assert.equal(fs.existsSync(path.join(target, ".env")), false);
    for (const name of imported) assert.deepEqual(fs.readFileSync(path.join(target, name)), fs.readFileSync(path.join(root, name)));
    const restored = new Store(target, { logger: quiet });
    assert.deepEqual(restored.guilds, store.guilds);
    assert.deepEqual(restored.state, store.state);
    assert.equal(restored.isLegacy(article("old")), true);
    assert.equal(restored.legacyX.has("12345"), true);
});

test("data import refuses an existing destination without modifying either history", async t => {
    const { root } = fixture(t);
    const target = directory(t);
    const filename = path.join(target, "guild_channels.json");
    writeJson(filename, { existing: "keep" });
    const before = fs.readFileSync(filename);
    await assert.rejects(importData(root, target), /destination already exists/);
    assert.deepEqual(fs.readFileSync(filename), before);
    const empty = directory(t);
    await assert.rejects(importData(root, empty), /destination already exists/);
    assert.deepEqual(fs.readdirSync(empty), []);
});

test("data import refuses to copy from a bot that holds the source lock", async t => {
    const { root } = fixture(t);
    const release = await lockfile.lock(root, { lockfilePath: path.join(root, ".bot.lock"), stale: 30000 });
    const target = path.join(directory(t), "state");
    try {
        await assert.rejects(importData(root, target), /Stop the source bot/);
        assert.equal(fs.existsSync(target), false);
    } finally {
        await release();
    }
});

test("corrupt history is rejected before publishing the destination and staging is cleaned", async t => {
    const { root } = fixture(t);
    fs.writeFileSync(path.join(root, "delivery_state.json"), "broken json");
    const parent = directory(t);
    await assert.rejects(importData(root, path.join(parent, "state"), { logger: quiet }), /Invalid delivery_state.json/);
    assert.deepEqual(fs.readdirSync(parent), []);
    assert.equal(fs.readFileSync(path.join(root, "delivery_state.json"), "utf8"), "broken json");
});

test("missing primary history with a backup and an empty source cannot become a fresh installation", async t => {
    const { root, store } = fixture(t);
    store.checkpoint();
    fs.renameSync(path.join(root, "delivery_state.json"), path.join(root, "delivery_state.json.bak"));
    const parent = directory(t);
    await assert.rejects(importData(root, path.join(parent, "state"), { logger: quiet }), /Cannot read delivery_state.json/);
    assert.deepEqual(fs.readdirSync(parent), []);
    await assert.rejects(importData(directory(t), path.join(parent, "state")), /No bot data files/);
});
