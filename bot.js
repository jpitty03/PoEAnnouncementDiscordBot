const fs = require("node:fs");
const path = require("node:path");
const { Client, Events, GatewayIntentBits } = require("discord.js");
const lockfile = require("proper-lockfile");
const { PROJECT_ROOT, loadConfig } = require("./utils/config");
const { Store } = require("./utils/store");
const { StorageError } = require("./utils/helpers");
const { createSources } = require("./utils/feeds");
const { DeliveryService } = require("./utils/delivery");
const { createCommandHandler, safeReply } = require("./utils/commands");
const { createLogger } = require("./utils/logger");
const { setupPolling } = require("./utils/polling");

function createBot(config, {
    logger = createLogger([config.token, config.xRssUrl]),
    client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
        allowedMentions: { parse: [], repliedUser: false },
        rest: { timeout: 20000, retries: 2 },
    }),
    store = new Store(config.dataDir, { logger }),
    sources = createSources(config, { logger }),
    onFatal = error => logger.error("Fatal bot error:", error),
} = {}) {
    const service = new DeliveryService({ client, store, sources, config, logger, onFatal });
    const commandController = new AbortController();
    const handleCommand = createCommandHandler({ store, config, sources, service, signal: commandController.signal, logger });
    const commandTasks = new Set();
    let poller;
    let stopping = false;

    const onMessage = message => {
        if (stopping) return;
        const task = handleCommand(message).catch(async error => {
            if (stopping && commandController.signal.aborted && !(error instanceof StorageError)) return;
            logger.error("Command failed:", error);
            if (error instanceof StorageError) onFatal(error);
            else await safeReply(message, "The command failed. Please check the bot log.", logger);
        }).finally(() => commandTasks.delete(task));
        commandTasks.add(task);
    };
    const onGuildDelete = guild => {
        if (stopping || guild.unavailable || !store.getGuild(guild.id)) return;
        try {
            store.updateGuild(guild.id, () => null);
        } catch (error) {
            onFatal(error);
        }
    };

    client.on(Events.MessageCreate, onMessage);
    client.on(Events.GuildDelete, onGuildDelete);
    client.on(Events.Error, error => logger.error("Discord client error:", error));
    client.on(Events.Warn, warning => logger.warn("Discord warning:", warning));
    client.on(Events.ShardError, error => logger.error("Discord connection error:", error));
    client.once(Events.ClientReady, () => {
        if (stopping) return;
        logger.info(`Logged in as ${client.user.tag}; news source: ${config.newsSource}.`);
        if (!config.xRssUrl && store.getGuilds("x").length) {
            logger.warn("Some servers enabled X posts, but X_RSS_URL is unset. News delivery remains active.");
        }
        poller = setupPolling(signal => client.isReady() ? service.poll(signal) : undefined, {
            intervalMs: config.pollIntervalMs, onError: onFatal,
        });
    });

    return {
        client, store, service,
        start: () => client.login(config.token),
        async stop() {
            stopping = true;
            commandController.abort();
            client.off(Events.MessageCreate, onMessage);
            client.off(Events.GuildDelete, onGuildDelete);
            await poller?.stop();
            await Promise.allSettled([...commandTasks]);
            await client.destroy();
        },
    };
}

async function main() {
    require("dotenv").config({ path: path.join(PROJECT_ROOT, ".env"), quiet: true });
    const config = loadConfig();
    const logger = createLogger([config.token, config.xRssUrl]);
    let bot;
    let release;
    let closing;

    function shutdown(code = 0) {
        process.exitCode = Math.max(process.exitCode || 0, code);
        if (closing) return closing;
        closing = (async () => {
            logger.info("Stopping the bot and finishing outstanding deliveries.");
            const deadline = setTimeout(() => {
                logger.error("Shutdown exceeded 35 seconds; exiting for the process supervisor.");
                process.exit(1);
            }, 35000);
            deadline.unref();
            try {
                await bot?.stop();
            } catch (error) {
                logger.error("Shutdown error:", error);
                process.exitCode = 1;
            } finally {
                try { await release?.(); } catch (error) { logger.error("Lock release failed:", error); process.exitCode = 1; }
                clearTimeout(deadline);
            }
        })();
        return closing;
    }

    const fatal = error => {
        logger.error("Stopping after a fatal error:", error);
        void shutdown(1);
    };

    try {
        fs.mkdirSync(config.dataDir, { recursive: true });
        release = await lockfile.lock(config.dataDir, {
            lockfilePath: path.join(config.dataDir, ".bot.lock"),
            stale: 30000, update: 10000, retries: 0, onCompromised: fatal,
        });
        bot = createBot(config, { logger, onFatal: fatal });
        process.on("SIGINT", () => { void shutdown(); });
        process.on("SIGTERM", () => { void shutdown(); });
        process.on("unhandledRejection", fatal);
        process.on("uncaughtException", fatal);
        await bot.start();
    } catch (error) {
        logger.error("Startup failed:", error);
        await shutdown(1);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error("Startup failed:", error.message);
        process.exitCode = 1;
    });
}

module.exports = { createBot, main };
