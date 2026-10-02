const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

class StorageError extends Error {
    constructor(message, cause) {
        super(message, { cause });
        this.name = "StorageError";
    }
}

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

function readJson(filename, fallback, validate = () => true) {
    let text;
    try {
        text = fs.readFileSync(filename, "utf8");
    } catch (error) {
        if (error.code === "ENOENT" && !fs.existsSync(`${filename}.bak`)) return structuredClone(fallback);
        throw new StorageError(`Cannot read ${path.basename(filename)}. Restore a valid file before restarting.`, error);
    }
    try {
        const value = JSON.parse(text.replace(/^\uFEFF/, ""));
        if (!validate(value)) throw new Error("Invalid data structure");
        return value;
    } catch (error) {
        // Never replace damaged history with empty history: that would repost old news.
        throw new StorageError(`Invalid ${path.basename(filename)}. The file was preserved; inspect it or restore its .bak.`, error);
    }
}

function replaceFile(filename, content) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    let fd;
    try {
        fd = fs.openSync(temporary, "wx", 0o600);
        fs.writeFileSync(fd, content, "utf8");
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(temporary, filename);
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}

function writeJson(filename, value) {
    try {
        const content = `${JSON.stringify(value, null, 2)}\n`;
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        if (fs.existsSync(filename)) replaceFile(`${filename}.bak`, fs.readFileSync(filename));
        replaceFile(filename, content);
    } catch (error) {
        throw new StorageError(`Cannot safely save ${path.basename(filename)}; posting must stop.`, error);
    }
}

module.exports = { StorageError, isRecord, readJson, writeJson };
