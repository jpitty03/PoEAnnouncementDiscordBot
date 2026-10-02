const path = require("node:path");
const { readJson, writeJson, isRecord, StorageError } = require("./helpers");
const { safeUrl } = require("./feeds");

const isSnowflake = value => typeof value === "string" && /^\d{17,20}$/.test(value);
const isDate = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const optionalDate = value => value === undefined || value === null || isDate(value);
const validGuild = (id, value) => isSnowflake(id) && isRecord(value) && isSnowflake(value.channelId) &&
    (value.tag === undefined || (typeof value.tag === "string" && value.tag.length <= 500)) &&
    (value.xposts === undefined || typeof value.xposts === "boolean") &&
    optionalDate(value.subscribedAt) && optionalDate(value.xSubscribedAt);

function validArticle(article, id) {
    return isRecord(article) && article.id === id &&
        typeof article.title === "string" && article.title.length > 0 && article.title.length <= 256 &&
        typeof article.description === "string" && article.description.length <= 2000 &&
        typeof article.category === "string" && article.category.length > 0 && article.category.length <= 100 &&
        Boolean(safeUrl(article.link)) && optionalDate(article.publishedAt) &&
        (article.thumbnail === null || Boolean(safeUrl(article.thumbnail)));
}

function validDelivery(guildId, delivery) {
    return isSnowflake(guildId) && isRecord(delivery) && ["pending", "sent", "skipped"].includes(delivery.status) &&
        optionalDate(delivery.subscription) && (delivery.status !== "sent" ||
            (isSnowflake(delivery.channelId) && typeof delivery.messageId === "string" && isDate(delivery.sentAt)));
}

function validState(state) {
    if (!isRecord(state) || state.version !== 1 || !isRecord(state.sources)) return false;
    return Object.values(state.sources).every(source => isRecord(source) && typeof source.initialized === "boolean" &&
        optionalDate(source.lastSuccessAt) && (source.lastError === null || typeof source.lastError === "string") &&
        Number.isFinite(source.retryAt) && source.retryAt >= 0 &&
        isRecord(source.items) && Object.entries(source.items).every(([id, entry]) =>
            isRecord(entry) && validArticle(entry.article, id) && isDate(entry.discoveredAt) &&
            isRecord(entry.deliveries) && Object.entries(entry.deliveries).every(([guildId, delivery]) =>
                validDelivery(guildId, delivery))));
}

class Store {
    constructor(dataDir, { logger = console, save = writeJson } = {}) {
        this.logger = logger;
        this.save = save;
        this.guildsFile = path.join(dataDir, "guild_channels.json");
        this.stateFile = path.join(dataDir, "delivery_state.json");
        this.guilds = readJson(this.guildsFile, {}, isRecord);
        this.state = readJson(this.stateFile, { version: 1, sources: {} }, validState);
        const legacyNews = readJson(path.join(dataDir, "posted_news.json"), {}, value =>
            isRecord(value) && Object.values(value).every(entry => isRecord(entry) && typeof entry.link === "string"));
        const legacyX = readJson(path.join(dataDir, "posted_x_news.json"), [], value =>
            Array.isArray(value) && value.every(id => typeof id === "string"));
        this.legacyLinks = new Set(Object.values(legacyNews).map(entry => safeUrl(entry.link)).filter(Boolean));
        this.legacyX = new Set(legacyX);
        for (const [id, guild] of Object.entries(this.guilds)) {
            if (!validGuild(id, guild)) logger.warn(`Ignoring invalid guild configuration: ${id}. The entry is preserved.`);
        }
    }

    assertHealthy() {
        if (this.failure) throw this.failure;
    }

    persist(filename, value) {
        this.assertHealthy();
        try {
            this.save(filename, value);
        } catch (error) {
            this.failure = error instanceof StorageError ? error : new StorageError("State could not be saved; posting must stop.", error);
            throw this.failure;
        }
    }

    checkpoint() {
        this.persist(this.stateFile, this.state);
    }

    getGuild(id) {
        return validGuild(id, this.guilds[id]) ? this.guilds[id] : null;
    }

    getGuilds(kind = "news") {
        return Object.entries(this.guilds).filter(([id, value]) => validGuild(id, value) && (kind !== "x" || value.xposts));
    }

    updateGuild(id, update) {
        const value = update(this.getGuild(id));
        if (value !== null && !validGuild(id, value)) throw new Error("Invalid guild configuration.");
        const next = { ...this.guilds };
        if (value === null) delete next[id];
        else next[id] = value;
        this.persist(this.guildsFile, next);
        this.guilds = next;
    }

    source(id) {
        this.assertHealthy();
        if (!Object.hasOwn(this.state.sources, id)) {
            this.state.sources[id] = { initialized: false, items: {}, lastSuccessAt: null, lastError: null, retryAt: 0 };
        }
        return this.state.sources[id];
    }

    isLegacy(article) {
        return this.legacyLinks.has(article.link) || (article.xId && this.legacyX.has(article.xId));
    }
}

module.exports = { Store, validState, validGuild, isSnowflake };
