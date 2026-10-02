const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseRss, parseSteam, createSources, safeUrl } = require("../utils/feeds");
const { loadConfig } = require("../utils/config");
const { quiet } = require("./support");

const rss = items => `<rss version="2.0"><channel><title>Test news</title>${items}</channel></rss>`;
const item = (id, title = "Update", more = "") => `<item><title>${title}</title><link>https://www.pathofexile.com/forum/view-thread/${id}</link>${more}</item>`;

test("RSS repairs bare ampersands without corrupting numeric entities or CDATA", async () => {
    const items = await parseRss(rss(item("1", "News & updates &#38; fixes &#x26; more", "<description><![CDATA[One & two <b>bold</b> &amp; three]]></description>")));
    assert.equal(items[0].title, "News & updates & fixes & more");
    assert.equal(items[0].description, "One & two bold & three");
});

test("RSS uses stable URLs, supports duplicate dates and emits oldest first", async () => {
    const date = "<pubDate>Fri, 02 Jan 2026 00:00:00 GMT</pubDate>";
    const items = await parseRss(rss(item("2", "Two", date) + item("1", "One", date) + item("0", "Old", "<pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate>")));
    assert.equal(items.length, 3);
    assert.equal(items[0].title, "Old");
    assert.notEqual(items[1].id, items[2].id);
    assert.equal(safeUrl("http://pathofexile.com/forum/view-thread/123/page/2#p1"), "https://www.pathofexile.com/forum/view-thread/123");
});

test("RSS skips invalid items, accepts empty feeds, and rejects malformed/block pages", async () => {
    const items = await parseRss(rss("<item><title>Missing link</title></item>" + item("1")), { logger: quiet });
    assert.equal(items.length, 1);
    assert.deepEqual(await parseRss(rss("")), []);
    await assert.rejects(parseRss("<html><body>Cloudflare</body></html>"), /Expected an RSS/);
    await assert.rejects(parseRss("<!DOCTYPE html><html/>"), /Expected RSS/);
    await assert.rejects(parseRss(rss("<item><link>javascript:alert(1)</link></item>")), /none had a valid/);
    await assert.rejects(parseRss("<rss><channel>"));
});

test("RSS bounds Discord fields and handles missing or invalid dates", async () => {
    const [result] = await parseRss(rss(item("1", "a".repeat(400), `<description>${"b".repeat(5000)}</description><pubDate>invalid</pubDate>`)));
    assert.equal(result.title.length, 256);
    assert.equal(result.description.length, 2000);
    assert.equal(result.publishedAt, null);
});

test("X supports object-shaped GUIDs and duplicate status IDs", async () => {
    const xml = rss('<item><guid isPermaLink="false">https://example.org/pathofexile/status/123</guid></item><item><link>https://x.com/pathofexile/status/123</link></item>');
    const items = await parseRss(xml, { kind: "x" });
    assert.equal(items.length, 1);
    assert.equal(items[0].link, "https://vxtwitter.com/pathofexile/status/123");
});

test("Steam filters publisher and app IDs and strips BBCode", () => {
    const base = { gid: "123", appid: 238960, feedname: "steam_community_announcements", title: "Update", date: 1767225600,
        contents: "[h3]Patch[/h3] [url=https://example.com]Details[/url] [img]hidden[/img]", url: "https://store.steampowered.com/news/app/238960/view/123" };
    const body = JSON.stringify({ appnews: { appid: 238960, newsitems: [base,
        { ...base, gid: "456", feedname: "gaming_press" }, { ...base, gid: "789", appid: 2694490 }] } });
    const items = parseSteam(body, "238960");
    assert.equal(items.length, 1);
    assert.equal(items[0].description, "Patch Details");
    assert.equal(items[0].publishedAt, "2026-01-01T00:00:00.000Z");
    assert.throws(() => parseSteam(body, "2694490"), /Unexpected/);
});

test("source selection provides independent Steam feeds and optional X", async () => {
    const requested = [];
    const sources = createSources(loadConfig({ NEWS_SOURCE: "steam", STEAM_APP_IDS: "238960,2694490" }, { requireToken: false }), {
        logger: quiet,
        fetchFeed: async url => {
            requested.push(new URL(url));
            return new Response(JSON.stringify({ appnews: { appid: Number(url.searchParams.get("appid")), newsitems: [] } }));
        },
    });
    assert.deepEqual(sources.map(source => source.id), ["steam:238960", "steam:2694490"]);
    await Promise.all(sources.map(source => source.load()));
    assert.ok(requested.every(url => url.searchParams.get("feeds") === "steam_community_announcements"));
    assert.equal(createSources(loadConfig({}, { requireToken: false })).length, 1);
});
