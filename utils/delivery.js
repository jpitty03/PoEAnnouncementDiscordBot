const { createHash } = require("node:crypto");
const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { truncate, safeUrl } = require("./feeds");

async function validateChannel(channel, guildId) {
    if (!channel || channel.guildId !== guildId ||
        ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        throw new Error("Choose a text or announcement channel in this server.");
    }
    const member = channel.guild.members.me || await channel.guild.members.fetchMe();
    const permissions = channel.permissionsFor(member);
    const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    if (!permissions?.has(required)) {
        throw new Error("I need View Channel, Send Messages, and Embed Links in that channel.");
    }
    return channel;
}

function allowedMentions(tag) {
    return {
        parse: /@(everyone|here)\b/.test(tag) ? ["everyone"] : [],
        roles: [...new Set([...tag.matchAll(/<@&(\d+)>/g)].map(match => match[1]))],
        users: [...new Set([...tag.matchAll(/<@!?(\d+)>/g)].map(match => match[1]))],
        repliedUser: false,
    };
}

function messagePayload(article, kind, tag = "") {
    if (kind === "x") return { content: article.link, allowedMentions: { parse: [] } };
    const embed = {
        title: truncate(article.title, 256), url: article.link,
        description: truncate(article.description || "Open the announcement to read more.", 2000),
        color: 0xc6362e,
        fields: [{ name: "Category", value: truncate(article.category || "News", 100), inline: true }],
    };
    if (article.publishedAt) embed.timestamp = article.publishedAt;
    if (article.thumbnail) embed.thumbnail = { url: article.thumbnail };
    return { ...(tag ? { content: tag } : {}), embeds: [embed], allowedMentions: allowedMentions(tag) };
}

function subscription(guild, kind) {
    return (kind === "x" ? guild.xSubscribedAt : guild.subscribedAt) || null;
}

class DeliveryService {
    constructor({ client, store, sources, config, logger = console, now = () => new Date(), onFatal = () => {} }) {
        Object.assign(this, { client, store, sources, config, logger, now, onFatal });
        this.work = Promise.resolve();
    }

    schedule(task, signal) {
        const running = this.work.then(() => {
            signal?.throwIfAborted();
            this.store.assertHealthy();
            return task();
        });
        // Manual requests and automatic polls share one queue to avoid simultaneous sends.
        this.work = running.catch(() => {});
        return running;
    }

    poll(signal) {
        return this.schedule(() => this.pollSources(signal), signal);
    }

    async pollSources(signal) {
        signal?.throwIfAborted();
        this.store.assertHealthy();
        const controller = new AbortController();
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        let failure;
        // Notify shutdown immediately, but keep the lock until every source has stopped.
        // Promise.all alone would return while another source still had a send in flight.
        await Promise.allSettled(this.sources.map(async source => {
            try {
                await this.runSource(source, combined);
            } catch (error) {
                if (!failure) {
                    failure = error;
                    controller.abort(error);
                    if (!signal?.aborted) this.onFatal(error);
                }
            }
        }));
        if (failure) throw failure;
    }

    postAnnouncement(guildId, selection = "latest", signal) {
        return this.schedule(() => this.postSelected(guildId, selection, signal), signal);
    }

    async postSelected(guildId, selection, signal) {
        if (!this.store.getGuild(guildId)) throw new Error("Set an announcement channel first with !setpoechannel #news.");
        const latest = selection.toLowerCase() === "latest";
        const link = latest ? null : safeUrl(selection.replace(/^<(.+)>$/, "$1"));
        if (!latest && !link) throw new Error("Use !postpoenews latest or !postpoenews <announcement URL>.");
        const definitions = this.sources.filter(source => source.kind === "news");
        const findSaved = () => {
            for (const definition of definitions) {
                const entry = Object.values(this.store.state.sources[definition.id]?.items || {})
                    .find(item => item.article.link === link);
                if (entry) return { definition, entry };
            }
            return null;
        };
        let selected = latest ? null : findSaved();
        if (!selected) {
            const results = await Promise.allSettled(definitions.map(async definition => {
                const state = this.store.state.sources[definition.id];
                if (state?.retryAt > this.now().getTime()) throw new Error("Feed is in a rate-limit cooldown.");
                return definition.load(signal);
            }));
            signal?.throwIfAborted();
            const candidates = [];
            let successful = 0;
            for (const [index, result] of results.entries()) {
                const definition = definitions[index];
                const state = this.store.source(definition.id);
                if (result.status === "rejected") {
                    state.lastError = truncate(result.reason.message || String(result.reason), 300);
                    state.retryAt = Math.max(state.retryAt || 0, result.reason.retryAt || 0);
                    this.logger.warn(`${definition.label}: manual announcement lookup failed.`, result.reason);
                    continue;
                }
                successful++;
                // Discover the full feed normally, so posting one item manually cannot
                // hide a newly discovered announcement from other servers' next poll.
                this.ingest(definition, state, result.value);
                state.lastSuccessAt = this.now().toISOString();
                state.lastError = null;
                state.retryAt = 0;
                for (const article of result.value) candidates.push({ definition, entry: state.items[article.id] });
            }
            this.store.checkpoint();
            if (!successful) throw new Error("Could not read the news feed. Try a saved announcement URL or retry later.");
            selected = latest ? candidates.sort((a, b) =>
                (Date.parse(b.entry.article.publishedAt) || 0) - (Date.parse(a.entry.article.publishedAt) || 0))[0] : findSaved();
        }
        if (!selected) throw new Error("No matching announcement was found. Use a saved URL or a link from the current news feed.");
        const { definition, entry } = selected;
        const previous = entry.deliveries[guildId];
        if (previous?.status === "sent") return { ...previous, status: "already_sent", article: entry.article };
        const guild = this.store.getGuild(guildId);
        if (!guild) throw new Error("This server's subscription changed. Set an announcement channel and try again.");
        entry.deliveries[guildId] = {
            ...(previous?.status === "pending" ? previous : {}),
            status: "pending", subscription: subscription(guild, definition.kind),
            requestedAt: this.now().toISOString(),
        };
        delete entry.deliveries[guildId].skipReason;
        this.store.checkpoint();
        await this.drain(definition, this.store.source(definition.id), signal, { guildId, articleId: entry.article.id });
        return { ...entry.deliveries[guildId], article: entry.article, channelId: guild.channelId };
    }

    async runSource(definition, signal) {
        const state = this.store.source(definition.id);
        if (this.store.getGuilds(definition.kind).length && (!state.retryAt || state.retryAt <= this.now().getTime())) {
            let articles;
            try {
                articles = await definition.load(signal);
            } catch (error) {
                signal?.throwIfAborted();
                state.lastError = truncate(error.message || String(error), 300);
                state.retryAt = error.retryAt || 0;
                this.logger.error(`${definition.label} check failed:`, error);
            }
            signal?.throwIfAborted();
            if (articles) {
                this.ingest(definition, state, articles);
                state.lastSuccessAt = this.now().toISOString();
                state.lastError = null;
                state.retryAt = 0;
            }
            this.store.checkpoint();
        }
        // Pending messages survive feed outages and entries disappearing from a feed.
        await this.drain(definition, state, signal);
    }

    ingest(definition, state, articles) {
        const baseline = !state.initialized && this.config.firstRunMode === "baseline";
        const guilds = this.store.getGuilds(definition.kind);
        for (const article of articles) {
            if (Object.hasOwn(state.items, article.id)) continue;
            const deliveries = Object.fromEntries(guilds.map(([guildId, guild]) => {
                const subscribedAt = subscription(guild, definition.kind);
                const predatesSubscription = subscribedAt && article.publishedAt && article.publishedAt < subscribedAt;
                const skipReason = baseline ? "startup_baseline" : this.store.isLegacy(article) ? "legacy_history" :
                    state.initialized && predatesSubscription ? "before_subscription" : null;
                return [guildId, {
                    status: skipReason ? "skipped" : "pending",
                    subscription: subscribedAt,
                    ...(skipReason ? { skipReason } : {}),
                }];
            }));
            state.items[article.id] = { article, deliveries, discoveredAt: this.now().toISOString() };
        }
        if (baseline) this.logger.info(`${definition.label}: recorded ${articles.length} existing entries as the startup baseline.`);
        state.initialized = true;
        const currentIds = new Set(articles.map(article => article.id));
        const settled = Object.entries(state.items).filter(([, entry]) =>
            Object.values(entry.deliveries).every(delivery => delivery.status !== "pending"));
        settled.sort((a, b) => b[1].discoveredAt.localeCompare(a[1].discoveredAt));
        for (const [id] of settled.slice(this.config.historyLimit)) {
            if (!currentIds.has(id)) delete state.items[id];
        }
    }

    async drain(definition, state, signal, { guildId: onlyGuildId, articleId } = {}) {
        const entries = Object.values(state.items).filter(entry => !articleId || entry.article.id === articleId).sort((a, b) =>
            (a.article.publishedAt || a.discoveredAt).localeCompare(b.article.publishedAt || b.discoveredAt));
        const guildIds = new Set(onlyGuildId ? [onlyGuildId] : entries.flatMap(entry => Object.keys(entry.deliveries)));
        for (const guildId of guildIds) {
            for (const entry of entries) {
                const delivery = entry.deliveries[guildId];
                if (delivery?.status !== "pending") continue;
                signal?.throwIfAborted();
                this.store.assertHealthy();
                const guild = this.store.getGuild(guildId);
                if (!guild || (definition.kind === "x" && !guild.xposts) ||
                    delivery.subscription !== subscription(guild, definition.kind)) {
                    delivery.status = "skipped";
                    delivery.skipReason = !guild || (definition.kind === "x" && !guild.xposts)
                        ? "unsubscribed" : "subscription_changed";
                    this.store.checkpoint();
                    continue;
                }
                let message;
                try {
                    const channel = await this.client.channels.fetch(guild.channelId);
                    await validateChannel(channel, guildId);
                    signal?.throwIfAborted();
                    this.store.assertHealthy();
                    // A command may have changed the destination while Discord was fetching it.
                    if (this.store.getGuild(guildId) !== guild) break;
                    const nonce = createHash("sha256")
                        .update(`${definition.id}:${entry.article.id}:${guildId}:${guild.channelId}`)
                        .digest("hex").slice(0, 24);
                    message = await channel.send({
                        ...messagePayload(entry.article, definition.kind, guild.tag || ""),
                        nonce, enforceNonce: true,
                    });
                } catch (error) {
                    this.store.assertHealthy();
                    signal?.throwIfAborted();
                    delivery.lastError = truncate(error.message || String(error), 300);
                    delivery.attempts = (delivery.attempts || 0) + 1;
                    this.store.checkpoint();
                    this.logger.warn(`${definition.label}: delivery to guild ${guildId} failed; retained for retry.`, error);
                    break; // Preserve ordering for this server; other servers still proceed.
                }
                // Save the acknowledgement even if shutdown arrived during channel.send().
                Object.assign(delivery, { status: "sent", channelId: guild.channelId,
                    messageId: message.id, sentAt: this.now().toISOString() });
                delete delivery.lastError;
                this.store.checkpoint();
                this.logger.info(`${definition.label}: delivered ${entry.article.id} to guild ${guildId}.`);
            }
        }
    }
}

module.exports = { DeliveryService, validateChannel, messagePayload, allowedMentions };
