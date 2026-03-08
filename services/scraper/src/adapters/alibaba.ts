import { config } from "../config";
import { parseMoney } from "../core/normalize";
import type { AdapterContext, ScraperAdapter } from "./base";
import type { NormalizedProduct, ScrapeQuery } from "../types";
import { withRetry } from "../utils/retry";
import { signTopParams, topTimestampUTC8 } from "../utils/topSign";

export const alibabaAdapter: ScraperAdapter = {
  source: "alibaba",
  supportsApi: true,
  supportsBrowser: true,
  async scrape(query: ScrapeQuery, ctx: AdapterContext): Promise<NormalizedProduct[]> {
    const baseUrl = config.providers.alibaba.baseUrl;
    const appKey = config.providers.alibaba.appKey;
    const appSecret = config.providers.alibaba.appSecret;
    const method = config.providers.alibaba.method;

    if (!baseUrl || !appKey || !appSecret || !method) {
      throw new Error(
        "Alibaba API not fully configured. Set ALIBABA_API_BASE, ALIBABA_APP_KEY, ALIBABA_APP_SECRET, ALIBABA_API_METHOD."
      );
    }

    let extraParams: Record<string, string> = {};
    if (config.providers.alibaba.extraParams) {
      try {
        extraParams = JSON.parse(config.providers.alibaba.extraParams) as Record<string, string>;
      } catch {
        throw new Error("ALIBABA_EXTRA_PARAMS must be valid JSON.");
      }
    }

    const params: Record<string, string> = {
      method,
      app_key: appKey,
      format: config.providers.alibaba.format,
      v: config.providers.alibaba.version,
      sign_method: config.providers.alibaba.signMethod,
      timestamp: topTimestampUTC8(),
      ...extraParams,
      [config.providers.alibaba.queryKey]: query.query,
      [config.providers.alibaba.limitKey]: String(query.limit ?? 20),
    };
    if (config.providers.alibaba.session) {
      params.session = config.providers.alibaba.session;
    }

    params.sign = signTopParams(params, appSecret, config.providers.alibaba.signMethod);

    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) throw new Error(`Alibaba API error: ${res.status}`);
          return res.json();
        } finally {
          clearTimeout(timer);
        }
      },
      { retries: 2, minDelayMs: 500, maxDelayMs: 4000 }
    );

    const items = Array.isArray(response?.result?.items)
      ? response.result.items
      : Array.isArray(response?.items)
      ? response.items
      : [];

    return items.map((item: Record<string, unknown>) => ({
      source: "alibaba",
      productId: String(item.productId ?? ""),
      title: String(item.title ?? ""),
      url: String(item.productUrl ?? ""),
      imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : undefined,
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
