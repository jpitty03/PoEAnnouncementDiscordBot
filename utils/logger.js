function createLogger(secrets = []) {
    function redact(value) {
        let result = value instanceof Error ? value.message : String(value);
        for (const secret of secrets.filter(Boolean)) result = result.split(secret).join("[REDACTED]");
        return result;
    }
    return Object.fromEntries(["info", "warn", "error"].map(level => [level, (...values) => {
        console[level](`${new Date().toISOString()} ${level.toUpperCase()}`, ...values.map(redact));
    }]));
}

module.exports = { createLogger };
