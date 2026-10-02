const path = require("node:path");
const { loadConfig, PROJECT_ROOT } = require("../utils/config");
const { createSources } = require("../utils/feeds");
const { createLogger } = require("../utils/logger");

async function main() {
    require("dotenv").config({ path: path.join(PROJECT_ROOT, ".env"), quiet: true });
    const config = loadConfig(process.env, { requireToken: false });
    const logger = createLogger([config.token, config.xRssUrl]);
    const sources = process.argv.includes("--all")
        ? [...createSources({ ...config, newsSource: "rss" }, { logger }),
            ...createSources({ ...config, newsSource: "steam", steamAppIds: ["238960", "2694490"], xRssUrl: null }, { logger })]
        : createSources(config, { logger });
    const results = await Promise.allSettled(sources.map(async source => {
        const articles = await source.load();
        logger.info(`${source.label}: ${articles.length} valid entries; newest: ${articles.at(-1)?.title || "none"}`);
    }));
    results.forEach((result, index) => {
        if (result.status === "rejected") {
            logger.error(`${sources[index].label} failed:`, result.reason);
            process.exitCode = 1;
        }
    });
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { main };
