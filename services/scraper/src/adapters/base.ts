import type { NormalizedProduct, ScrapeQuery, ScrapeResult, SourceId } from "../types";

export type AdapterContext = {
  now: string;
  timeoutMs: number;
};

export interface ScraperAdapter {
  source: SourceId;
  supportsApi: boolean;
  supportsBrowser: boolean;
  scrape(query: ScrapeQuery, ctx: AdapterContext): Promise<NormalizedProduct[]>;
}

export function wrapResult(
  source: SourceId,
  query: string,
  items: NormalizedProduct[],
  tookMs: number,
  cached: boolean
): ScrapeResult {
  return { source, query, items, tookMs, cached };
}
