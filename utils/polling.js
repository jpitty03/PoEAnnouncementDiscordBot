function setupPolling(task, { intervalMs = 600000, onError = console.error, immediate = true } = {}) {
    if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new RangeError("Polling interval must be positive.");
    const controller = new AbortController();
    let timer;
    let running;
    let stopped = false;

    function runNow() {
        if (stopped) return Promise.resolve();
        if (running) return running;
        clearTimeout(timer);
        running = Promise.resolve()
            .then(() => task(controller.signal))
            .catch(error => { if (!controller.signal.aborted) onError(error); })
            .finally(() => {
                running = null;
                // Schedule after completion; slow polls can never overlap.
                if (!stopped) timer = setTimeout(runNow, intervalMs);
            });
        return running;
    }

    async function stop() {
        stopped = true;
        clearTimeout(timer);
        controller.abort();
        await running;
    }

    if (immediate) void runNow();
    else timer = setTimeout(runNow, intervalMs);
    return { runNow, stop };
}

module.exports = { setupPolling };
