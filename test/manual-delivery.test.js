const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DeliveryService } = require("../utils/delivery");
const { Store } = require("../utils/store");
const { fixture, article, quiet, config, GUILD_A, GUILD_B, CHANNEL_A, CHANNEL_B, deferred } = require("./support");

function makeService(setup, load, overrides = {}) {
    return new DeliveryService({ ...setup, sources: [{ id: "rss", kind: "news", label: "RSS", load }],
        config: { ...config, firstRunMode: "baseline" }, logger: quiet, ...overrides });
}

test("deleting history still respects the subscription date; explicit posting overrides it", async t => {
    const setup = fixture(t, { guilds: { [GUILD_A]: {
        channelId: CHANNEL_A, subscribedAt: "2026-02-01T00:00:00.000Z",
    } } });
    const news = article();
    const service = makeService(setup, async () => [news]);
    await service.poll();
    assert.equal(setup.store.source("rss").items[news.id].deliveries[GUILD_A].skipReason, "startup_baseline");
    delete setup.store.source("rss").items[news.id];
    setup.store.checkpoint();
    await service.poll();
    assert.equal(setup.channels[CHANNEL_A].sent.length, 0);
    assert.equal(setup.store.source("rss").items[news.id].deliveries[GUILD_A].skipReason, "before_subscription");
    const result = await service.postAnnouncement(GUILD_A, news.link);
    assert.equal(result.status, "sent");
    await service.poll();
    assert.equal(setup.channels[CHANNEL_A].sent.length, 1);
    assert.equal(new Store(setup.root, { logger: quiet }).source("rss").items[news.id].deliveries[GUILD_A].status, "sent");
});

test("an article recorded for an old server can be posted only to the newly subscribed server", async t => {
    const setup = fixture(t, { guilds: { [GUILD_A]: { channelId: CHANNEL_A } } });
    let loads = 0;
    const news = article();
    const service = makeService(setup, async () => { loads++; return [news]; });
    await service.poll();
    setup.store.updateGuild(GUILD_A, () => null);
    setup.store.updateGuild(GUILD_B, () => ({ channelId: CHANNEL_B, subscribedAt: "2026-02-01T00:00:00.000Z" }));
    await service.postAnnouncement(GUILD_B, news.link);
    assert.equal(loads, 1, "A saved URL works without fetching the feed again");
    assert.equal(setup.channels[CHANNEL_A].sent.length, 0);
    assert.equal(setup.channels[CHANNEL_B].sent.length, 1);
    assert.equal(setup.store.source("rss").items[news.id].deliveries[GUILD_A].status, "skipped");
    assert.equal(setup.store.source("rss").items[news.id].deliveries[GUILD_B].status, "sent");
});

test("latest refreshes the feed and sends only the newest item to the requesting server", async t => {
    const setup = fixture(t);
    const news = [article("1"), article("2", { publishedAt: "2026-01-02T00:00:00.000Z" })];
    const service = makeService(setup, async () => news);
    const result = await service.postAnnouncement(GUILD_A, "latest");
    assert.equal(result.article.id, news[1].id);
    assert.deepEqual(setup.channels[CHANNEL_A].sent.map(payload => payload.embeds[0].title), ["News 2"]);
    assert.equal(setup.channels[CHANNEL_B].sent.length, 0);
    await service.poll();
    assert.equal(setup.channels[CHANNEL_A].sent.length, 1);
    assert.equal(setup.channels[CHANNEL_B].sent.length, 0);
});

test("manual discovery preserves automatic delivery for other eligible servers", async t => {
    const setup = fixture(t);
    let news = [];
    const service = makeService(setup, async () => news);
    await service.poll();
    news = [article("1"), article("2", { publishedAt: "2026-01-02T00:00:00.000Z" })];
    await service.postAnnouncement(GUILD_A, news[1].link);
    assert.equal(setup.channels[CHANNEL_B].sent.length, 0);
    await service.poll();
    assert.deepEqual(setup.channels[CHANNEL_B].sent.map(payload => payload.embeds[0].title), ["News 1", "News 2"]);
    assert.equal(setup.channels[CHANNEL_A].sent.filter(payload => payload.embeds[0].title === "News 2").length, 1);
});

test("concurrent manual commands and automatic delivery cannot double-send", async t => {
    const setup = fixture(t);
    const news = article();
    const service = makeService(setup, async () => [news], { config });
    const started = deferred();
    const response = deferred();
    let sends = 0;
    setup.channels[CHANNEL_A].send = async () => { sends++; started.resolve(); return response.promise; };
    const poll = service.poll();
    await started.promise;
    const first = service.postAnnouncement(GUILD_A, news.link);
    const second = service.postAnnouncement(GUILD_A, news.link);
    response.resolve({ id: "automatic-message" });
    await poll;
    assert.equal((await first).status, "already_sent");
    assert.equal((await second).status, "already_sent");
    assert.equal(sends, 1);
});

test("a failed explicit delivery survives restart and retries despite the article's age", async t => {
    const setup = fixture(t, { guilds: { [GUILD_A]: {
        channelId: CHANNEL_A, subscribedAt: "2026-02-01T00:00:00.000Z",
    } } });
    setup.channels[CHANNEL_A].send = async () => { throw new Error("Missing Access"); };
    const news = article();
    const result = await makeService(setup, async () => [news]).postAnnouncement(GUILD_A, news.link);
    assert.equal(result.status, "pending");
    assert.equal(result.lastError, "Missing Access");
    const store = new Store(setup.root, { logger: quiet });
    let sent = 0;
    setup.channels[CHANNEL_A].send = async () => { sent++; return { id: "retry-success" }; };
    await makeService({ ...setup, store }, async () => { throw new Error("Feed offline"); }).poll();
    assert.equal(sent, 1);
    assert.equal(store.source("rss").items[news.id].deliveries[GUILD_A].status, "sent");
});

test("manual lookup does not fetch arbitrary URLs or bypass a source's rate-limit cooldown", async t => {
    const setup = fixture(t);
    let loads = 0;
    const service = makeService(setup, async () => { loads++; return []; });
    await assert.rejects(service.postAnnouncement(GUILD_A, "file:///private"), /Use !postpoenews/);
    assert.equal(loads, 0);
    setup.store.source("rss").retryAt = Date.now() + 600000;
    await assert.rejects(service.postAnnouncement(GUILD_A, "latest"), /Could not read the news feed/);
    assert.equal(loads, 0);
    setup.store.source("rss").retryAt = 0;
    await assert.rejects(service.postAnnouncement(GUILD_A, "https://example.org/unrelated"), /No matching announcement/);
    assert.equal(loads, 1, "Only the configured source loader is used");
});

test("shutdown cancels manual feed lookups before queueing any announcement", async t => {
    const setup = fixture(t);
    const controller = new AbortController();
    const started = deferred();
    const service = makeService(setup, signal => {
        started.resolve();
        return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const running = service.postAnnouncement(GUILD_A, "latest", controller.signal);
    await started.promise;
    controller.abort();
    await assert.rejects(running, { name: "AbortError" });
    assert.equal(setup.channels[CHANNEL_A].sent.length, 0);
    assert.deepEqual(setup.store.state.sources, {});
});
