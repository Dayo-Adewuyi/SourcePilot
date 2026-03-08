import type { ScraperAdapter, AdapterContext } from "./base";
import type { ScrapeQuery, NormalizedProduct } from "../types";
import { alibabaAdapter } from "./alibaba";
import { indiamartAdapter } from "./indiamart";
import { madeInChinaAdapter } from "./madeinchina";
import { amazonAdapter } from "./amazon";
import { genericBrowserAdapter } from "./generic";

const adapters: ScraperAdapter[] = [
  alibabaAdapter,
  indiamartAdapter,
  madeInChinaAdapter,
  amazonAdapter,
  genericBrowserAdapter,
];

export function getAdapter(source: ScrapeQuery["source"], useBrowser = false): ScraperAdapter {
  if (useBrowser) return genericBrowserAdapter;
  const adapter = adapters.find((item) => item.source === source);
  if (!adapter) return genericBrowserAdapter;
  return adapter;
}

export async function runAdapter(
  query: ScrapeQuery,
  ctx: AdapterContext
): Promise<NormalizedProduct[]> {
  const adapter = getAdapter(query.source, query.useBrowser);
  try {
    return await adapter.scrape(query, ctx);
  } catch (error) {
    if (adapter.supportsBrowser) {
      return genericBrowserAdapter.scrape({ ...query, useBrowser: true }, ctx);
    }
    throw error;
  }
}
