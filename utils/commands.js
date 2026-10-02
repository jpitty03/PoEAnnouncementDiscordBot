const { PermissionFlagsBits } = require("discord.js");
const { validateChannel } = require("./delivery");
const { truncate } = require("./feeds");
const { StorageError } = require("./helpers");

const MOD_PERMISSIONS = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageMessages, PermissionFlagsBits.KickMembers];
const HELP = [
    "**Path of Exile news commands**",
    "`!setpoechannel #channel` — Choose the announcement channel.",
    "`!setpoetag <tag>` — Set a prefix or role mention; use `clear` to remove it.",
    "`!togglex` — Enable or disable X posts (requires the bot owner's X RSS source).",
    "`!poenewsstatus` — Show this server's configuration, feed health and pending posts.",
    "`!postpoenews latest` or `!postpoenews <URL>` — Send one existing news announcement to this server.",
    "`!unsetpoechannel` — Stop announcements for this server.",
    "`!poenewshelp` — Show these commands.",
].join("\n");
const COMMANDS = new Set(["!setpoechannel", "!setpoetag", "!togglex", "!poenewsstatus", "!postpoenews", "!unsetpoechannel", "!poenewshelp"]);

async function safeReply(message, content, logger = console) {
    try {
        await message.reply({ content: truncate(content, 2000), allowedMentions: { parse: [], repliedUser: false } });
    } catch (error) {
        logger.warn("Could not reply to a command:", error);
    }
}

function createCommandHandler({ store, config, sources, service, signal, logger = console, now = () => new Date() }) {
    return async message => {
        if (message.author?.bot || !message.guild || !message.member || !message.content) return;
        const [rawCommand, ...args] = message.content.trim().split(/\s+/);
        const command = rawCommand.toLowerCase();
        if (!COMMANDS.has(command) || !MOD_PERMISSIONS.some(permission => message.member.permissions.has(permission))) return;
        const reply = content => safeReply(message, content, logger);
        const guildId = message.guild.id;
        if (command === "!poenewshelp") return reply(HELP);
        if (command === "!setpoechannel") {
            const channel = message.mentions.channels.first();
            try {
                await validateChannel(channel, guildId);
            } catch (error) {
                return reply(`${error.message} Usage: \`!setpoechannel #news\``);
            }
            store.updateGuild(guildId, current => ({ ...current, channelId: channel.id,
                tag: current?.tag || "", xposts: current?.xposts || false,
                subscribedAt: current?.subscribedAt || (current ? undefined : now().toISOString()) }));
            return reply(`Future announcements will be sent to <#${channel.id}>. Use \`!postpoenews latest\` to send an existing announcement now.`);
        }
        if (command === "!poenewsstatus") {
            const guild = store.getGuild(guildId);
            const lines = [guild ? `Channel: <#${guild.channelId}>\nTag: ${guild.tag || "none"}` : "No announcement channel is configured.",
                `X posts: ${guild?.xposts ? (config.xRssUrl ? "enabled" : "waiting for X_RSS_URL") : "disabled"}`];
            if (guild?.subscribedAt) lines.push(`Automatic news starts from <t:${Math.floor(Date.parse(guild.subscribedAt) / 1000)}:F>.`);
            for (const source of sources) {
                const state = store.state.sources[source.id];
                const pending = Object.values(state?.items || {}).filter(entry => entry.deliveries[guildId]?.status === "pending");
                const deliveryError = pending.find(entry => entry.deliveries[guildId].lastError)?.deliveries[guildId].lastError;
                lines.push(`${source.label}: last success ${state?.lastSuccessAt || "never"}; ${pending.length} pending.`);
                if (state?.lastError) lines.push(`Feed error: ${state.lastError}`);
                if (deliveryError) lines.push(`Delivery error: ${deliveryError}`);
            }
            return reply(lines.join("\n"));
        }
        if (!store.getGuild(guildId)) return reply("Set an announcement channel first with `!setpoechannel #news`.");
        if (command === "!postpoenews") {
            if (args.length !== 1) return reply("Usage: `!postpoenews latest` or `!postpoenews <announcement URL>`.");
            try {
                const result = await service.postAnnouncement(guildId, args[0], signal);
                if (result.status === "already_sent") return reply("That announcement has already been delivered to this server.");
                if (result.status === "sent") return reply(`Posted to <#${result.channelId}>: ${result.article.link}`);
                if (result.status === "skipped") return reply("The server subscription changed during delivery. Check !poenewsstatus and try again.");
                return reply(`The announcement is queued for retry. ${result.lastError || "Check !poenewsstatus for delivery progress."}`);
            } catch (error) {
                if (error instanceof StorageError || signal?.aborted) throw error;
                return reply(error.message);
            }
        }
        if (command === "!unsetpoechannel") {
            store.updateGuild(guildId, () => null);
            return reply("Announcements are disabled for this server.");
        }
        if (command === "!setpoetag") {
            const value = args.join(" ");
            if (!value || value.length > 500) return reply("Provide a tag of 1–500 characters, or use `!setpoetag clear`.");
            const tag = value.toLowerCase() === "clear" ? "" : value;
            store.updateGuild(guildId, current => ({ ...current, tag }));
            return reply(tag ? `Announcement tag set to: ${tag}` : "Announcement tag cleared.");
        }
        if (command === "!togglex") {
            const enabled = !store.getGuild(guildId).xposts;
            if (enabled && !config.xRssUrl) return reply("The bot owner must configure X_RSS_URL before X posts can be enabled.");
            store.updateGuild(guildId, current => ({ ...current, xposts: enabled,
                xSubscribedAt: enabled ? now().toISOString() : current.xSubscribedAt }));
            return reply(`X posts are ${enabled ? "enabled" : "disabled"}.`);
        }
    };
}

module.exports = { createCommandHandler, safeReply };
