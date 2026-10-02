const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { retryFetch, HttpError, ResponseTooLargeError } = require("../utils/retryFetch");
const { setupPolling } = require("../utils/polling");
const { deferred } = require("./support");

test("HTTP retries transient errors, respects Retry-After and returns a readable body", async () => {
    let calls = 0;
    const waits = [];
    const response = await retryFetch("https://example.org", {}, 3, 1000, {
        fetchImpl: async () => ++calls === 1 ? new Response("limited", { status: 429, headers: { "Retry-After": "2" } }) : new Response("news"),
        wait: async delay => waits.push(delay), random: () => 0,
    });
    assert.equal(calls, 2);
    assert.ok(waits[0] >= 1900);
    assert.equal(await response.text(), "news");
});

test("HTTP retries network/5xx errors but does not retry permanent 4xx", async () => {
    let calls = 0;
    const response = await retryFetch("https://example.org", {}, 3, 1000, {
        fetchImpl: async () => {
            calls++;
            if (calls === 1) throw new TypeError("Network failure");
            return calls === 2 ? new Response("server error", { status: 503 }) : new Response("ok");
        }, wait: async () => {},
    });
    assert.equal(await response.text(), "ok");
    assert.equal(calls, 3);
    calls = 0;
    await assert.rejects(retryFetch("https://example.org", {}, 3, 1000, {
        fetchImpl: async () => { calls++; return new Response("forbidden", { status: 403 }); },
    }), HttpError);
    assert.equal(calls, 1);
});

test("long Retry-After returns a cooldown rather than retrying early", async () => {
    let waits = 0;
    await assert.rejects(retryFetch("https://example.org", {}, 3, 1000, {
        fetchImpl: async () => new Response("limited", { status: 429, headers: { "retry-after": "3600" } }),
        wait: async () => { waits++; },
    }), error => error.retryAt > Date.now() + 3500000);
    assert.equal(waits, 0);
    const now = Date.now();
    const error = new HttpError(new Response(null, { status: 429, headers: { "Retry-After": new Date(now + 60000).toUTCString() } }), now);
    assert.ok(error.retryAt > now + 59000);
});

test("HTTP enforces body-size limits even without Content-Length", async () => {
    let calls = 0;
    await assert.rejects(retryFetch("https://example.org", {}, 3, 1000, {
        fetchImpl: async () => { calls++; return new Response("a".repeat(100)); }, maxBytes: 10,
    }), ResponseTooLargeError);
    assert.equal(calls, 1);
});

test("HTTP timeout includes a body that stalls after headers", { timeout: 5000 }, async t => {
    const server = http.createServer((request, response) => {
        response.writeHead(200, { "content-type": "application/xml" });
        response.write("<rss>");
    });
    t.after(() => { server.closeAllConnections(); server.close(); });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    await assert.rejects(retryFetch(`http://127.0.0.1:${server.address().port}`, {}, 1, 100), /timed out|abort/i);
});

test("HTTP cancellation interrupts retry backoff and prevents further requests", async () => {
    const controller = new AbortController();
    let calls = 0;
    const started = deferred();
    const running = retryFetch("https://example.org", { signal: controller.signal }, 3, 1000, {
        fetchImpl: async () => { calls++; started.resolve(); throw new Error("Offline"); },
    });
    await started.promise;
    controller.abort();
    await assert.rejects(running, { name: "AbortError" });
    assert.equal(calls, 1);
});

test("polling coalesces overlapping runs and stop prevents new checks", async () => {
    let calls = 0;
    const gate = deferred();
    const poller = setupPolling(async () => { calls++; await gate.promise; }, { intervalMs: 600000, immediate: false });
    try {
        const first = poller.runNow();
        assert.equal(first, poller.runNow());
        await Promise.resolve();
        assert.equal(calls, 1);
        gate.resolve();
        await first;
        await poller.stop();
        await poller.runNow();
        assert.equal(calls, 1);
    } finally { gate.resolve(); await poller.stop(); }
});

test("polling catches failures, recovers on the next run, and aborts active work", async () => {
    let calls = 0;
    const errors = [];
    let signal;
    const poller = setupPolling(async currentSignal => {
        signal = currentSignal;
        if (++calls === 1) throw new Error("Temporary error");
    }, { intervalMs: 600000, immediate: false, onError: error => errors.push(error) });
    try {
        await poller.runNow();
        await poller.runNow();
        assert.equal(calls, 2);
        assert.equal(errors.length, 1);
        await poller.stop();
        assert.equal(signal.aborted, true);
    } finally { await poller.stop(); }
});
