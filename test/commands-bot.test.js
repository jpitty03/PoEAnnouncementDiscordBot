const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Events, ChannelType } = require("discord.js");
const { createBot } = require("../bot");
const { createCommandHandler } = require("../utils/commands");
const { messagePayload } = require("../utils/delivery");
const { Store } = require("../utils/store");
const { createLogger } = require("../utils/logger");
const { fixture, channel, article, quiet, config, GUILD_A, CHANNEL_A, CHANNEL_B, deferred } = require("./support");

function message(content, mentionedChannel, overrides = {}) {
    const replies = [];
    return { content, replies, guild: { id: GUILD_A }, author: { bot: false },
        member: { permissions: { has: () => true } }, mentions: { channels: { first: () => mentionedChannel } },
        async reply(payload) { replies.push(payload); }, ...overrides };
}

function handler(setup, overrides = {}) {
    return createCommandHandler({ ...setup, config, sources: [], logger: quiet, ...overrides });
}

test("commands ignore DMs, bots, unrelated messages and non-moderators", async t => {
    const setup = fixture(t);
    const handle = handler(setup);
    for (const command of [message("!poenewshelp", null, { guild: null, member: null }),
        message("!poenewshelp", null, { author: { bot: true } }), message("hello"),
        message("!unsetpoechannel", null, { member: { permissions: { has: () => false } } })]) {
        await handle(command);
        assert.equal(command.replies.length, 0);
    }
    assert.ok(setup.store.getGuild(GUILD_A));
});

test("channel setup rejects foreign channels, unsupported types and missing permissions", async t => {
    const setup = fixture(t);
    const wrongType = channel();
    wrongType.type = ChannelType.GuildVoice;
    const noPermissions = channel();
    noPermissions.permissionsFor = () => ({ has: () => false });
    for (const selected of [undefined, setup.channels[CHANNEL_B], wrongType, noPermissions]) {
        const command = message("!setpoechannel #news", selected);
        await handler(setup)(command);
        assert.equal(command.replies.length, 1);
        assert.match(command.replies[0].content, /Choose|need/);
    }
});

test("channel setup merges the latest configuration after an asynchronous permission lookup", async t => {
    const setup = fixture(t);
    const selected = channel(GUILD_A, CHANNEL_B);
    const gate = deferred();
    selected.guild.members = { me: null, fetchMe: () => gate.promise };
    const handle = handler(setup);
    const changing = handle(message("!setpoechannel #new", selected));
    await handle(message("!setpoetag updated"));
    gate.resolve({});
    await changing;
    const saved = new Store(setup.root, { logger: quiet }).getGuild(GUILD_A);
    assert.equal(saved.channelId, CHANNEL_B);
    assert.equal(saved.tag, "updated");
});

test("tag replies cannot ping and clearing a tag persists", async t => {
    const setup = fixture(t);
    const command = message("!setpoetag @everyone");
    await handler(setup)(command);
    assert.equal(setup.store.getGuild(GUILD_A).tag, "@everyone");
    assert.deepEqual(command.replies[0].allowedMentions, { parse: [], repliedUser: false });
    await handler(setup)(message("!setpoetag clear"));
    assert.equal(new Store(setup.root, { logger: quiet }).getGuild(GUILD_A).tag, "");
});

test("announcement mention permissions come only from the moderator-configured tag", () => {
    const tag = "@everyone <@&300000000000000001> <@300000000000000002>";
    const payload = messagePayload(article(), "news", tag);
    assert.deepEqual(payload.allowedMentions.parse, ["everyone"]);
    assert.deepEqual(payload.allowedMentions.roles, ["300000000000000001"]);
    assert.deepEqual(payload.allowedMentions.users, ["300000000000000002"]);
    assert.deepEqual(messagePayload(article(), "news").allowedMentions.parse, []);
    assert.deepEqual(messagePayload(article(), "x", tag).allowedMentions, { parse: [] });
});

test("X can be disabled without a provider, but enabling requires one", async t => {
    const setup = fixture(t);
    const handle = handler(setup);
    await handle(message("!togglex"));
    assert.equal(setup.store.getGuild(GUILD_A).xposts, false);
    const blocked = message("!togglex");
    await handle(blocked);
    assert.match(blocked.replies[0].content, /X_RSS_URL/);
    assert.equal(setup.store.getGuild(GUILD_A).xposts, false);
    await handler(setup, { config: { ...config, xRssUrl: "https://example.org/rss" } })(message("!togglex"));
    assert.equal(setup.store.getGuild(GUILD_A).xposts, true);
    assert.ok(setup.store.getGuild(GUILD_A).xSubscribedAt);
});

test("status reports pending delivery and feed errors; unsubscribe persists", async t => {
    const setup = fixture(t);
    const state = setup.store.source("rss");
    state.lastError = "Feed down";
    state.items[article().id] = { article: article(), deliveries: { [GUILD_A]: { status: "pending", lastError: "Missing permissions" } } };
    const command = message("!poenewsstatus");
    const handle = handler(setup, { sources: [{ id: "rss", label: "Official RSS" }] });
    await handle(command);
    assert.match(command.replies[0].content, /1 pending/);
    assert.match(command.replies[0].content, /Feed down/);
    assert.match(command.replies[0].content, /Missing permissions/);
    await handle(message("!unsetpoechannel"));
    assert.equal(new Store(setup.root, { logger: quiet }).getGuild(GUILD_A), null);
});

test("failed replies are contained without sending DMs", async t => {
    const setup = fixture(t);
    const command = message("!poenewshelp", null, { reply: async () => { throw new Error("No permission"); } });
    await assert.doesNotReject(handler(setup)(command));
});

test("bot shutdown aborts feed requests and destroys the Discord client", async t => {
    const setup = fixture(t);
    const client = new EventEmitter();
    client.channels = setup.client.channels;
    client.user = { tag: "test-bot" };
    client.isReady = () => true;
    client.login = async () => { client.emit(Events.ClientReady); };
    let destroyed = false;
    client.destroy = async () => { destroyed = true; };
    const started = deferred();
    let feedSignal;
    const sources = [{ id: "rss", kind: "news", label: "RSS", load: signal => {
        feedSignal = signal;
        started.resolve();
        return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    } }];
    const errors = [];
    const bot = createBot({ ...config, token: "unused" }, {
        client, store: setup.store, sources, logger: quiet, onFatal: error => errors.push(error),
    });
    await bot.start();
    await started.promise;
    await bot.stop();
    assert.equal(feedSignal.aborted, true);
    assert.equal(destroyed, true);
    assert.equal(client.listenerCount(Events.MessageCreate), 0);
    assert.deepEqual(errors, []);
    assert.equal(setup.channels[CHANNEL_A].sent.length, 0);
});

test("logging redacts configured credentials without dumping error request objects", t => {
    const output = [];
    t.mock.method(console, "error", (...args) => output.push(args.join(" ")));
    createLogger(["secret-token"]).error("Failed", Object.assign(new Error("token secret-token was rejected"), { request: { token: "hidden" } }));
    assert.match(output[0], /\[REDACTED\]/);
    assert.doesNotMatch(output[0], /secret-token|hidden/);
});

test("posting an existing announcement is moderator-only and always scoped to the command's server", async t => {
    const setup = fixture(t);
    const requests = [];
    const signal = new AbortController().signal;
    const service = { async postAnnouncement(...args) {
        requests.push(args);
        return { status: "sent", channelId: CHANNEL_A, article: article() };
    } };
    const handle = handler(setup, { service, signal });
    await handle(message("!postpoenews latest", null, { member: { permissions: { has: () => false } } }));
    await handle(message("!postpoenews"));
    assert.equal(requests.length, 0);
    const command = message(`!postpoenews ${article().link}`);
    await handle(command);
    assert.deepEqual(requests, [[GUILD_A, article().link, signal]]);
    assert.match(command.replies[0].content, /Posted to/);
});

test("manual posting reports queued failures and prevents repeated sends", async t => {
    const setup = fixture(t);
    const pending = message("!postpoenews latest");
    await handler(setup, { service: { async postAnnouncement() {
        return { status: "pending", lastError: "Missing Access" };
    } } })(pending);
    assert.match(pending.replies[0].content, /queued for retry.*Missing Access/);
    const duplicate = message("!postpoenews latest");
    await handler(setup, { service: { async postAnnouncement() { return { status: "already_sent" }; } } })(duplicate);
    assert.match(duplicate.replies[0].content, /already been delivered/);
});
