import { config } from "../config";
import { parseMoney } from "../core/normalize";
import type { AdapterContext, ScraperAdapter } from "./base";
import type { NormalizedProduct, ScrapeQuery } from "../types";
import { withRetry } from "../utils/retry";

export const indiamartAdapter: ScraperAdapter = {
  source: "indiamart",
  supportsApi: true,
  supportsBrowser: true,
  async scrape(query: ScrapeQuery, ctx: AdapterContext): Promise<NormalizedProduct[]> {
    const baseUrl = config.providers.indiamart.baseUrl;
    const apiKey = config.providers.indiamart.apiKey;

    if (!baseUrl || !apiKey) {
      throw new Error("IndiaMART API not configured. Set INDIAMART_API_BASE and INDIAMART_API_KEY.");
    }

    const url = new URL("/search", baseUrl);
    url.searchParams.set("q", query.query);
    url.searchParams.set("limit", String(query.limit ?? 20));
    url.searchParams.set("apiKey", apiKey);

    const response = await withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) throw new Error(`IndiaMART API error: ${res.status}`);
          return res.json();
        } finally {
          clearTimeout(timer);
        }
      },
      { retries: 2, minDelayMs: 500, maxDelayMs: 4000 }
    );

    const items = Array.isArray(response?.items) ? response.items : [];

    return items.map((item: Record<string, unknown>) => ({
      source: "indiamart",
      productId: String(item.id ?? ""),
      title: String(item.name ?? ""),
      url: String(item.url ?? ""),
      imageUrl: typeof item.image === "string" ? item.image : undefined,
      price: parseMoney(String(item.price ?? ""), query.currency ?? config.defaultCurrency),
      moq: Number.parseInt(String(item.moq ?? ""), 10) || undefined,
      supplierName: typeof item.supplier === "string" ? item.supplier : undefined,
      supplierRating: Number.parseFloat(String(item.rating ?? "")) || undefined,
      location: typeof item.location === "string" ? item.location : undefined,
      updatedAt: ctx.now,
      raw: item,
    }));
  },
};
