const { setTimeout: sleep } = require("node:timers/promises");

class HttpError extends Error {
    constructor(response, now = Date.now()) {
        super(`HTTP ${response.status} ${response.statusText}`.trim());
        this.name = "HttpError";
        this.status = response.status;
        const value = response.headers.get("retry-after");
        const delay = value === null ? 0 : /^\d+(?:\.\d+)?$/.test(value)
            ? Number(value) * 1000 : Date.parse(value) - now;
        this.retryAt = Number.isFinite(delay) && delay > 0 ? now + delay : 0;
    }
}

class ResponseTooLargeError extends Error {}

async function readBody(response, maxBytes) {
    if (Number(response.headers.get("content-length")) > maxBytes) {
        throw new ResponseTooLargeError(`Feed exceeds the ${maxBytes} byte limit.`);
    }
    if (!response.body) return Buffer.alloc(0);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new ResponseTooLargeError(`Feed exceeds the ${maxBytes} byte limit.`);
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

// The timeout covers headers AND the response body. The returned response is buffered.
async function retryFetch(url, options = {}, maxAttempts = 3, timeoutMs = 30000, {
    fetchImpl = globalThis.fetch,
    wait = (ms, signal) => sleep(ms, undefined, { signal }),
    random = Math.random,
    maxBytes = 2097152,
    maxRetryDelayMs = 30000,
} = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError("Fetch attempts and timeout must be positive.");
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        options.signal?.throwIfAborted();
        const controller = new AbortController();
        const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
        const timer = setTimeout(() => controller.abort(new Error("Feed request timed out.")), timeoutMs);
        let failure;
        try {
            const response = await fetchImpl(url, { ...options, signal });
            if (!response.ok) throw new HttpError(response);
            const body = await readBody(response, maxBytes);
            return new Response(body.length ? body : null, {
                status: response.status, statusText: response.statusText, headers: response.headers,
            });
        } catch (error) {
            failure = error;
        } finally {
            clearTimeout(timer);
            controller.abort();
        }
        options.signal?.throwIfAborted();
        const retryable = !(failure instanceof ResponseTooLargeError) &&
            (!(failure instanceof HttpError) || [408, 425, 429].includes(failure.status) || failure.status >= 500);
        const retryAfter = Math.max(0, (failure.retryAt || 0) - Date.now());
        if (!retryable || attempt === maxAttempts || retryAfter > maxRetryDelayMs) throw failure;
        const backoff = Math.min(maxRetryDelayMs, 1000 * 2 ** (attempt - 1) + Math.floor(random() * 250));
        await wait(Math.max(backoff, retryAfter), options.signal);
    }
}

module.exports = { retryFetch, HttpError, ResponseTooLargeError };
