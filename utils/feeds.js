const { parseStringPromise } = require("xml2js");
const { retryFetch } = require("./retryFetch");

function xmlText(value) {
    if (Array.isArray(value)) return xmlText(value[0]);
    if (value && typeof value === "object") return xmlText(value._);
    return typeof value === "string" ? value : "";
}

function safeUrl(value) {
    if (typeof value !== "string" || value.length > 2048) return null;
    try {
        const url = new URL(value.trim());
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
        url.hash = "";
        const thread = /^(?:www\.)?pathofexile\.com$/i.test(url.hostname) &&
            url.pathname.match(/^\/forum\/view-thread\/(\d+)(?:\/|$)/);
        if (thread) return `https://www.pathofexile.com/forum/view-thread/${thread[1]}`;
        return url.href;
    } catch {
        return null;
    }
}

function decodeEntities(value) {
    const names = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
        if (code[0] !== "#") return names[code.toLowerCase()] || entity;
        const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
            ? String.fromCodePoint(point) : "";
    });
}

function plainText(value) {
    return decodeEntities(String(value || "")
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>|<\/(?:p|div|li)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\[(?:img|previewyoutube)[^\]]*\][\s\S]*?\[\/(?:img|previewyoutube)\]/gi, "")
        .replace(/\[\/?(?:url|b|i|u|h[1-6]|list|olist|\*|quote|code)(?:=[^\]]*)?\]/gi, ""))
        .replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function truncate(value, length) {
    if (value.length <= length) return value;
    return value.slice(0, length - 1).replace(/[\uD800-\uDBFF]$/, "") + "…";
}

function isoDate(value) {
    const timestamp = typeof value === "number" ? value : Date.parse(value);
    return Number.isFinite(timestamp) && Math.abs(timestamp) <= 8640000000000000
        ? new Date(timestamp).toISOString() : null;
}

function repairBareAmpersands(xml) {
    // GGG's feed can contain bare '&'. Keep CDATA, comments and numeric entities intact.
    return xml.split(/(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->)/g)
        .map((part, index) => index % 2 ? part :
            part.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, "&amp;"))
        .join("");
}

function finishItems(items, inputCount, logger) {
    const valid = items.filter(Boolean);
    if (inputCount && !valid.length) throw new Error("Feed contained entries, but none had a valid announcement URL or ID.");
    if (valid.length < inputCount) logger.warn(`Skipped ${inputCount - valid.length} invalid feed entries.`);
    return [...new Map(valid.map(item => [item.id, item])).values()]
        .sort((a, b) => (Date.parse(a.publishedAt) || 0) - (Date.parse(b.publishedAt) || 0));
}

async function parseRss(xml, { kind = "news", logger = console } = {}) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Expected RSS; HTML challenge pages and XML document types are unsupported.");
    const parsed = await parseStringPromise(repairBareAmpersands(xml));
    const channel = parsed?.rss?.channel?.[0];
    if (!channel || typeof channel !== "object") throw new Error("Expected an RSS channel; the source may have returned a block page.");
    const rawItems = channel.item || [];
    const thumbnail = safeUrl(xmlText(channel.image?.[0]?.url));
    const items = [...rawItems].reverse().map(item => {
        if (kind === "x") {
            const id = [xmlText(item.guid), xmlText(item.link)]
                .map(value => value.match(/\/status\/(\d+)/)?.[1]).find(Boolean);
            if (!id) return null;
            return { id: `x:${id}`, xId: id, title: "Path of Exile on X",
                link: `https://vxtwitter.com/pathofexile/status/${id}`, description: "",
                publishedAt: isoDate(xmlText(item.pubDate)), category: "X", thumbnail: null };
        }
        const link = safeUrl(xmlText(item.link)) || safeUrl(xmlText(item.guid));
        if (!link) return null;
        return {
            id: `url:${link}`, link,
            title: truncate(plainText(xmlText(item.title)) || "Path of Exile announcement", 256),
            description: truncate(plainText(xmlText(item.description)).replace(/Read More\.?\s*$/i, ""), 2000),
            publishedAt: isoDate(xmlText(item.pubDate)),
            category: truncate(plainText(xmlText(item.category)) || "News", 100), thumbnail,
        };
    });
    return finishItems(items, rawItems.length, logger);
}

function parseSteam(body, appId, logger = console) {
    const data = JSON.parse(body);
    if (String(data.appnews?.appid) !== appId || !Array.isArray(data.appnews?.newsitems)) {
        throw new Error("Unexpected Steam news response.");
    }
    // Restrict the public API to publisher announcements, excluding gaming press feeds.
    const rawItems = data.appnews.newsitems.filter(item =>
        item.feedname === "steam_community_announcements" && String(item.appid) === appId);
    const items = rawItems.map(item => {
        const link = safeUrl(item.url);
        if (typeof item.gid !== "string" || !/^\d+$/.test(item.gid) || !link || typeof item.title !== "string") return null;
        return {
            id: `steam:${appId}:${item.gid}`, link,
            title: truncate(plainText(item.title) || "Path of Exile announcement", 256),
            description: truncate(plainText(item.contents), 2000),
            publishedAt: typeof item.date === "number" ? isoDate(item.date * 1000) : null,
            category: appId === "238960" ? "Path of Exile 1" : "Path of Exile 2", thumbnail: null,
        };
    });
    return finishItems(items, rawItems.length, logger);
}

function createSources(config, { fetchFeed = retryFetch, logger = console } = {}) {
    const read = async (url, signal) => {
        const response = await fetchFeed(url, {
            signal,
            headers: { "User-Agent": "PoEAnnouncementDiscordBot/2.0", Accept: "application/rss+xml, application/xml, application/json" },
        }, config.httpMaxAttempts, config.httpTimeoutMs, { maxBytes: config.httpMaxBytes });
        return response.text();
    };
    const sources = config.newsSource === "steam" ? config.steamAppIds.map(appId => {
        const url = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
        url.search = new URLSearchParams({ appid: appId, count: "20", maxlength: "10000", feeds: "steam_community_announcements" });
        return { id: `steam:${appId}`, kind: "news", label: `Steam PoE ${appId === "238960" ? "1" : "2"}`,
            load: async signal => parseSteam(await read(url, signal), appId, logger) };
    }) : [{ id: "rss", kind: "news", label: "Official RSS",
        load: async signal => parseRss(await read(config.rssUrl, signal), { logger }) }];
    if (config.xRssUrl) sources.push({ id: "x", kind: "x", label: "X RSS",
        load: async signal => parseRss(await read(config.xRssUrl, signal), { kind: "x", logger }) });
    return sources;
}

module.exports = { createSources, parseRss, parseSteam, plainText, safeUrl, truncate, repairBareAmpersands };
