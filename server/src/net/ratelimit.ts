import type { RateLimiter } from "../domain/repos";

/**
 * Fixed-window rate limiter on the Workers Cache API.
 *
 * Trade-off (documented): caches.default is per-colo, so limits are approximate
 * across Cloudflare's edge locations. For this game's abuse-control purpose
 * (raising the cost of spam well above its value) that is acceptable and free;
 * a global limiter would require KV writes per request (latency + quota burn).
 */
export class CacheRateLimiter implements RateLimiter {
  constructor(private readonly scope: string) {}

  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const cache = caches.default;
    const cacheKey = new Request(
      `https://rate-limit.internal/${this.scope}/${encodeURIComponent(key)}`,
      { method: "GET" }
    );

    let count = 0;
    let resetAt = now + windowMs;
    const hit = await cache.match(cacheKey);
    if (hit) {
      const state = (await hit.json()) as { count: number; resetAt: number };
      if (state.resetAt > now) {
        count = state.count;
        resetAt = state.resetAt;
      }
    }

    count += 1;
    const ttlS = Math.max(1, Math.ceil((resetAt - now) / 1000));
    const body = JSON.stringify({ count, resetAt });
    const res = new Response(body, {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlS}` },
    });
    await cache.put(cacheKey, res);

    return count <= limit;
  }
}

/** Deterministic limiter for unit tests. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = this.nowMs();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    return w.count <= limit;
  }
}
