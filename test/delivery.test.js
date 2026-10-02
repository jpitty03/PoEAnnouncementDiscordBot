const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DeliveryService } = require("../utils/delivery");
const { Store } = require("../utils/store");
const { StorageError } = require("../utils/helpers");
const { fixture, article, quiet, config, GUILD_A, GUILD_B, CHANNEL_A, CHANNEL_B, deferred } = require("./support");

const source = load => ({ id: "rss", kind: "news", label: "News", load });
const service = (setup, sources, overrides = {}) => new DeliveryService({ ...setup, sources, config, logger: quiet, ...overrides });

test("failed guild retries across restart without reposting to successful guild", async t => {
    const setup = fixture(t);
    setup.channels[CHANNEL_B].send = async () => { throw new Error("Missing permission"); };
    await service(setup, [source(async () => [article()])]).poll();
    assert.equal(setup.channels[CHANNEL_A].sent.length, 1);
    assert.equal(setup.store.source("rss").items[article().id].deliveries[GUILD_B].status, "pending");
    const store = new Store(setup.root, { logger: quiet });
    let delivered = 0;
    setup.channels[CHANNEL_B].send = async () => { delivered++; return { id: "recovered" }; };
    await service({ ...setup, store }, [source(async () => [])]).poll();
    assert.equal(setup.channels[CHANNEL_A].sent.length, 1);
    assert.equal(delivered, 1);
    assert.equal(store.source("rss").items[article().id].deliveries[GUILD_B].status, "sent");
});

test("pending deliveries run during feed outages and other sources keep working", async t => {
    const setup = fixture(t);
    setup.channels[CHANNEL_A].send = async () => { throw new Error("Temporarily unavailable"); };
    const initial = service(setup, [source(async () => [article()])]);
    await initial.poll();
    let delivered = 0;
    setup.channels[CHANNEL_A].send = async () => { delivered++; return { id: "ok" }; };
    const sources = [source(async () => { throw new Error("Feed down"); }),
        { id: "x", kind: "x", label: "X", load: async () => [article("x", { id: "x:123", xId: "123", link: "https://vxtwitter.com/pathofexile/status/123" })] }];
    await service(setup, sources).poll();
    assert.equal(delivered, 2);
    assert.equal(setup.store.source("rss").lastError, "Feed down");
    assert.ok(setup.store.source("x").lastSuccessAt);
});

test("first run baselines history, and only newly discovered posts are sent", async t => {
    const setup = fixture(t);
    let articles = [article("1")];
    const bot = service(setup, [source(async () => articles)], { config: { ...config, firstRunMode: "baseline" } });
    await bot.poll();
    assert.equal(setup.channels[CHANNEL_A].sent.length, 0);
    articles = [article("1"), article("2")];
    await bot.poll();
    await bot.poll();
    assert.equal(setup.channels[CHANNEL_A].sent.length, 1);
    assert.equal(setup.channels[CHANNEL_A].sent[0].embeds[0].title, "News 2");
});

test("legacy news links and X IDs suppress old posts without modifying legacy files", async t => {
    const setup = fixture(t, { legacyNews: { old: { title: "Old", link: "http://pathofexile.com/forum/view-thread/1" } }, legacyX: ["123"] });
    const legacyBefore = fs.readFileSync(path.join(setup.root, "posted_news.json"), "utf8");
    await service(setup, [source(async () => [article("1"), article("2")]),
        { id: "x", kind: "x", label: "X", load: async () => [article("x", { id: "x:123", xId: "123" })] }]).poll();
    assert.equal(setup.channels[CHANNEL_A].sent.length, 1);
    assert.equal(setup.channels[CHANNEL_A].sent[0].embeds[0].title, "News 2");
    assert.equal(fs.readFileSync(path.join(setup.root, "posted_news.json"), "utf8"), legacyBefore);
});

test("new source baselines independently and disabled X is never fetched", async t => {
    const setup = fixture(t, { guilds: { [GUILD_A]: { channelId: CHANNEL_A, xposts: false } } });
    let xCalls = 0;
    const bot = service(setup, [source(async () => [article()]),
        { id: "x", kind: "x", label: "X", load: async () => { xCalls++; return []; } }]);
    await bot.poll();
    assert.equal(xCalls, 0);
    await service(setup, [{ ...source(async () => [article("2")]), id: "steam:238960" }],
        { config: { ...config, firstRunMode: "baseline" } }).poll();
    assert.equal(setup.channels[CHANNEL_A].sent.length, 1);
});

test("one failing guild does not block others and maintains announcement ordering", async t => {
    const setup = fixture(t);
    setup.channels[CHANNEL_A].send = async () => { throw new Error("No access"); };
    await service(setup, [source(async () => [article("2", { publishedAt: "2026-01-02T00:00:00.000Z" }), article("1")])]).poll();
    assert.deepEqual(setup.channels[CHANNEL_B].sent.map(payload => payload.embeds[0].title), ["News 1", "News 2"]);
    assert.equal(setup.store.source("rss").items[article("2").id].deliveries[GUILD_A].attempts, undefined);
});

test("storage failure before dispatch stops delivery; failure after send stops further dispatch", async t => {
    const setup = fixture(t);
    const realSave = setup.store.save;
    setup.store.save = () => { throw new Error("Disk full"); };
    await assert.rejects(service(setup, [source(async () => [article()])]).poll(), StorageError);
    assert.equal(setup.channels[CHANNEL_A].sent.length, 0);
    const store = new Store(setup.root, { logger: quiet });
    setup.channels[CHANNEL_A].send = async () => { store.save = () => { throw new Error("Disk full"); }; return { id: "sent" }; };
    store.save = realSave;
    await assert.rejects(service({ ...setup, store }, [source(async () => [article(), article("2")])]).poll(), StorageError);
    assert.equal(setup.channels[CHANNEL_B].sent.length, 0);
});

test("shutdown during send saves the acknowledgement before stopping", async t => {
    const setup = fixture(t);
    const started = deferred();
    const response = deferred();
    const controller = new AbortController();
    setup.channels[CHANNEL_A].send = () => { started.resolve(); return response.promise; };
    const running = service(setup, [source(async () => [article()])]).poll(controller.signal);
    await started.promise;
    controller.abort();
    response.resolve({ id: "sent-during-shutdown" });
    await assert.rejects(running, { name: "AbortError" });
    const saved = new Store(setup.root, { logger: quiet });
    assert.equal(saved.source("rss").items[article().id].deliveries[GUILD_A].messageId, "sent-during-shutdown");
    assert.equal(setup.channels[CHANNEL_B].sent.length, 0);
});

test("changed configuration is rechecked after fetching the channel", async t => {
    const setup = fixture(t);
    setup.client.channels.fetch = async () => {
        setup.store.updateGuild(GUILD_A, () => null);
        return setup.channels[CHANNEL_A];
    };
    await service(setup, [source(async () => [article()])]).poll();
    assert.equal(setup.channels[CHANNEL_A].sent.length, 0);
});

test("retention never discards pending items or current feed entries", async t => {
    const setup = fixture(t);
    setup.channels[CHANNEL_A].send = async () => { throw new Error("Unavailable"); };
    let articles = [article("1"), article("2")];
    const bot = service(setup, [source(async () => articles)], { config: { ...config, historyLimit: 1 } });
    await bot.poll();
    articles = [article("3")];
    await bot.poll();
    assert.equal(Object.keys(setup.store.source("rss").items).length, 3);
});

test("Retry-After cooldown survives restart without delaying queued delivery", async t => {
    const setup = fixture(t);
    const error = Object.assign(new Error("Rate limited"), { retryAt: Date.now() + 600000 });
    await service(setup, [source(async () => { throw error; })]).poll();
    let calls = 0;
    const store = new Store(setup.root, { logger: quiet });
    await service({ ...setup, store }, [source(async () => { calls++; return []; })]).poll();
    assert.equal(calls, 0);
});

test("fatal failure waits for another source's active send before releasing the poll", async t => {
    const setup = fixture(t);
    const otherStarted = deferred();
    const otherResponse = deferred();
    const fatal = deferred();
    setup.channels[CHANNEL_A].send = payload => {
        if (payload.content) { otherStarted.resolve(); return otherResponse.promise; }
        setup.store.save = () => { throw new Error("Disk full"); };
        return Promise.resolve({ id: "news-sent" });
    };
    const sources = [source(async () => { await otherStarted.promise; return [article()]; }),
        { id: "x", kind: "x", label: "X", load: async () => [article("x", { id: "x:123", xId: "123" })] }];
    let finished = false;
    const running = service(setup, sources, { onFatal: error => fatal.resolve(error) }).poll()
        .then(() => { finished = true; }, error => { finished = true; return error; });
    assert.ok(await fatal.promise instanceof StorageError);
    assert.equal(finished, false);
    otherResponse.resolve({ id: "x-sent" });
    assert.ok(await running instanceof StorageError);
    assert.equal(finished, true);
});

test("explicit first-run backfill includes older entries for a newly configured server", async t => {
    const setup = fixture(t, { guilds: { [GUILD_A]: { channelId: CHANNEL_A, subscribedAt: "2026-02-01T00:00:00.000Z" } } });
    await service(setup, [source(async () => [article()])]).poll();
    assert.equal(setup.channels[CHANNEL_A].sent.length, 1);
});

test("new subscriptions skip old dated entries discovered after a long idle period", async t => {
    const setup = fixture(t);
    let articles = [article()];
    const bot = service(setup, [source(async () => articles)]);
    await bot.poll();
    setup.store.updateGuild(GUILD_A, current => ({ ...current, subscribedAt: "2026-02-01T00:00:00.000Z" }));
    articles = [article("2"), article("3", { publishedAt: "2026-02-02T00:00:00.000Z" })];
    await bot.poll();
    assert.deepEqual(setup.channels[CHANNEL_A].sent.map(payload => payload.embeds[0].title), ["News 1", "News 3"]);
});
