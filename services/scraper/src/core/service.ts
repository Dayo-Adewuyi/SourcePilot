import PQueue from "p-queue";
import { config } from "../config";
import type { NormalizedProduct, ScrapeQuery, ScrapeResult } from "../types";
import { Cache } from "../utils/cache";
import type { Redis } from "ioredis";
import { runAdapter } from "../adapters";

const queue = new PQueue({ concurrency: config.concurrency });

export class ScrapeService {
  private cache: Cache;

  constructor(redis?: Redis) {
    this.cache = new Cache(redis, config.cacheTtlSeconds);
  }

  async scrape(query: ScrapeQuery): Promise<ScrapeResult> {
    const start = Date.now();
    const cacheKey = `scrape:${query.source}:${query.query}:${query.limit ?? ""}:${query.currency ?? ""}:${query.useBrowser ? "b" : "a"}`;

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return {
        source: query.source,
        query: query.query,
        items: JSON.parse(cached),
        tookMs: Date.now() - start,
        cached: true,
      };
    }

    const items =
      (await queue.add<NormalizedProduct[]>(async () => {
      const now = new Date().toISOString();
      return runAdapter(query, { now, timeoutMs: config.requestTimeoutMs });
      })) ?? [];

    await this.cache.set(cacheKey, JSON.stringify(items));

    return {
      source: query.source,
      query: query.query,
      items,
      tookMs: Date.now() - start,
      cached: false,
    };
  }

  async scrapeBatch(queries: ScrapeQuery[]): Promise<ScrapeResult[]> {
    return Promise.all(queries.map((q) => this.scrape(q)));
  }
}
