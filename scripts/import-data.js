const fs = require("node:fs");
const path = require("node:path");
const lockfile = require("proper-lockfile");
const { Store } = require("../utils/store");

const DATA_FILES = ["guild_channels.json", "delivery_state.json", "posted_news.json", "posted_x_news.json"];
const IMPORT_FILES = DATA_FILES.flatMap(name => [name, `${name}.bak`]);

function snapshot(directory) {
    const files = new Map();
    for (const name of IMPORT_FILES) {
        const filename = path.join(directory, name);
        let info;
        try { info = fs.lstatSync(filename); } catch (error) {
            if (error.code === "ENOENT") continue;
            throw error;
        }
        if (!info.isFile()) throw new Error(`Expected a regular file: ${name}`);
        files.set(name, fs.readFileSync(filename));
    }
    return files;
}

async function importData(sourceDirectory, targetDirectory, { logger = console } = {}) {
    const source = fs.realpathSync(sourceDirectory);
    const target = path.resolve(targetDirectory);
    const parent = path.dirname(target);
    if (fs.existsSync(target)) throw new Error("The destination already exists. Import only into a new data directory.");
    const sourceLock = { lockfilePath: path.join(source, ".bot.lock"), stale: 30000 };
    if (await lockfile.check(source, sourceLock)) throw new Error("Stop the source bot before importing its data.");

    const files = snapshot(source);
    if (!DATA_FILES.some(name => files.has(name))) throw new Error("No bot data files were found in the source directory.");
    fs.mkdirSync(parent, { recursive: true });
    const staging = fs.mkdtempSync(path.join(parent, ".poe-import-"));
    let committed = false;
    try {
        for (const [name, content] of files) {
            fs.writeFileSync(path.join(staging, name), content, { flag: "wx", mode: 0o600 });
        }
        // Validate the entire snapshot before it becomes the bot's data directory.
        new Store(staging, { logger });
        if (await lockfile.check(source, sourceLock)) throw new Error("The source bot started during import. Stop it and retry.");
        const current = snapshot(source);
        if (current.size !== files.size || [...files].some(([name, content]) => !content.equals(current.get(name) || Buffer.alloc(0)))) {
            throw new Error("Source data changed during import. Stop the source bot and retry.");
        }
        if (fs.existsSync(target)) throw new Error("The destination was created during import. Stop the destination bot and retry.");
        // Publish the whole validated directory in a single rename. Never merge histories.
        fs.renameSync(staging, target);
        committed = true;
        return [...files.keys()];
    } finally {
        if (!committed && path.dirname(staging) === parent && path.basename(staging).startsWith(".poe-import-")) {
            fs.rmSync(staging, { recursive: true, force: true });
        }
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length !== 2) {
        console.error("Usage: node scripts/import-data.js <source-directory> <new-data-directory>");
        process.exitCode = 1;
    } else {
        importData(args[0], args[1]).then(files => {
            console.log(`Imported ${files.length} data files. Source files were preserved.`);
        }).catch(error => {
            console.error(`Import failed: ${error.message}`);
            process.exitCode = 1;
        });
    }
}

module.exports = { importData, DATA_FILES };
