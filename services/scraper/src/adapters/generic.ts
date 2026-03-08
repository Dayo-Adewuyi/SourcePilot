import type { AdapterContext, ScraperAdapter } from "./base";
import type { NormalizedProduct, ScrapeQuery, SourceId } from "../types";
import { config } from "../config";
import { parseMoney } from "../core/normalize";
import { getBrowser } from "../core/browser";
import fs from "fs/promises";
import path from "path";

const selectorsBySource: Record<SourceId, { item: string; title: string; price?: string; url?: string; image?: string }> = {
  alibaba: {
    item: "[data-spm] .list-no-v2-outter, [data-spm] .organic-list-offer-outter",
    title: "h2, .title",
    price: ".price, .price-list",
    url: "a",
    image: "img",
  },
  "1688": {
    item: "li, .offer-item",
    title: "h4, .title",
    price: ".price",
    url: "a",
    image: "img",
  },
  indiamart: {
    item: ".card, .lst_pdt",
    title: "h2, .product-title",
    price: ".price",
    url: "a",
    image: "img",
  },
  madeinchina: {
    item: ".product-list .item",
    title: ".product-name, h2",
    price: ".price",
    url: "a",
    image: "img",
  },
  amazon: {
    item: "[data-component-type='s-search-result']",
    title: "h2 span",
    price: ".a-price .a-offscreen",
    url: "h2 a",
    image: "img",
  },
  dhgate: {
    item: ".list-item, .product-item",
    title: ".title, .product-title",
    price: ".price",
    url: "a",
    image: "img",
  },
  tradekey: {
    item: ".product-box, .product-item",
    title: ".product-name, h2",
    price: ".price",
    url: "a",
    image: "img",
  },
  globalsources: {
    item: ".product-item, .product-card",
    title: ".product-name, h2",
    price: ".price",
    url: "a",
    image: "img",
  },
  generic: {
    item: "article, li, .product",
    title: "h2, h3, .title",
    price: ".price",
    url: "a",
    image: "img",
  },
  custom: {
    item: "article, li, .product",
    title: "h2, h3, .title",
    price: ".price",
    url: "a",
    image: "img",
  },
};

export const genericBrowserAdapter: ScraperAdapter = {
  source: "generic",
  supportsApi: false,
  supportsBrowser: true,
  async scrape(query: ScrapeQuery, ctx: AdapterContext): Promise<NormalizedProduct[]> {
    const browser = await getBrowser();
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
    });

    try {
      const searchUrl = query.targetUrl ? query.targetUrl : buildSearchUrl(query);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: ctx.timeoutMs });
      await page.waitForTimeout(config.browserWaitMs);
      for (let i = 0; i < config.browserScrolls; i += 1) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(500);
      }

      const selectors = query.selectors ?? selectorsBySource[query.source] ?? selectorsBySource.generic;
      const items = await page.$$eval(
        selectors.item,
        (nodes, sel) =>
          nodes.map((node) => {
            const getText = (selector?: string) =>
              selector ? (node.querySelector(selector)?.textContent ?? "").trim() : "";
            const getAttr = (selector?: string, attr = "href") =>
              selector ? (node.querySelector(selector)?.getAttribute(attr) ?? "") : "";

            return {
              title: getText(sel.title),
              price: getText(sel.price),
              url: getAttr(sel.url),
              image: getAttr(sel.image, "src"),
            };
          }),
        selectors
      );

      const limited = (query.limit ? items.slice(0, query.limit) : items).filter(
        (item) => item.title && item.url
      );

      if (config.debug.enabled && limited.length === 0) {
        await fs.mkdir(config.debug.dir, { recursive: true });
        const stamp = Date.now();
        await page.screenshot({
          path: path.join(config.debug.dir, `scrape-${query.source}-${stamp}.png`),
          fullPage: true,
        });
        const html = await page.content();
        await fs.writeFile(path.join(config.debug.dir, `scrape-${query.source}-${stamp}.html`), html, "utf8");
      }

      return limited
        .filter((item) => item.title && item.url)
        .map((item) => ({
          source: query.source === "custom" ? "generic" : query.source,
          title: item.title,
          url: normalizeUrl(searchUrl, item.url),
          imageUrl: item.image || undefined,
          price: parseMoney(item.price, query.currency ?? config.defaultCurrency),
          supplierName: undefined,
          supplierRating: undefined,
          moq: undefined,
          location: undefined,
          updatedAt: ctx.now,
          raw: item,
        }));
    } finally {
      await page.close();
    }
  },
};

function buildSearchUrl(query: ScrapeQuery): string {
  const keyword = encodeURIComponent(query.query);
  switch (query.source) {
    case "alibaba":
      return `https://www.alibaba.com/trade/search?SearchText=${keyword}`;
    case "1688":
      return `https://s.1688.com/selloffer/offer_search.htm?keywords=${keyword}`;
    case "indiamart":
      return `https://dir.indiamart.com/search.mp?ss=${keyword}`;
    case "madeinchina":
      return `https://www.made-in-china.com/products-search/hot-china-products/${keyword}.html`;
    case "amazon":
      return `https://www.amazon.com/s?k=${keyword}`;
    case "dhgate":
      return `https://www.dhgate.com/wholesale/search.do?searchkey=${keyword}`;
    case "tradekey":
      return `https://www.tradekey.com/search/companies/${keyword}.html`;
    case "globalsources":
      return `https://www.globalsources.com/search?query=${keyword}`;
    default:
      return `https://www.google.com/search?q=${keyword}`;
  }
}

function normalizeUrl(base: string, href: string): string {
  if (!href) return base;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
