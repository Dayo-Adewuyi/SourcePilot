import { config } from "../config";
import { parseMoney } from "../core/normalize";
import type { AdapterContext, ScraperAdapter } from "./base";
import type { NormalizedProduct, ScrapeQuery } from "../types";
import { signSigV4 } from "../utils/awsSigV4";

export const amazonAdapter: ScraperAdapter = {
  source: "amazon",
  supportsApi: true,
  supportsBrowser: false,
  async scrape(query: ScrapeQuery, ctx: AdapterContext): Promise<NormalizedProduct[]> {
    const { baseUrl, accessKey, secretKey, partnerTag, region, host, marketplace, searchIndex } =
      config.providers.amazon;

    if (!baseUrl || !accessKey || !secretKey || !partnerTag) {
      throw new Error(
        "Amazon PA API not configured. Set AMAZON_PA_API_BASE, AMAZON_PA_ACCESS_KEY, AMAZON_PA_SECRET_KEY, AMAZON_PA_PARTNER_TAG."
      );
    }

    const endpoint = new URL(baseUrl);
    const apiHost = host ?? endpoint.host;
    const path = endpoint.pathname === "/" ? "/" : endpoint.pathname;

    const payloadObject: Record<string, unknown> = {
      Keywords: query.query,
      ItemCount: Math.min(query.limit ?? 10, 10),
      PartnerTag: partnerTag,
      PartnerType: "Associates",
      Marketplace: marketplace,
      Resources: [
        "Images.Primary.Medium",
        "ItemInfo.Title",
        "OffersV2.Listings.Price",
        "OffersV2.Listings.MerchantInfo",
      ],
    };
    if (searchIndex) payloadObject.SearchIndex = searchIndex;

    const payload = JSON.stringify(payloadObject);

    const baseHeaders = {
      "content-encoding": "amz-1.0",
      "content-type": "application/json; charset=utf-8",
      "x-amz-target": "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems",
    };

    const signed = signSigV4({
      method: "POST",
      host: apiHost,
      path,
      query: "",
      region: region ?? "us-east-1",
      service: "ProductAdvertisingAPI",
      accessKey,
      secretKey,
      payload,
      headers: baseHeaders,
    });

    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: signed.headers,
      body: payload,
    });
    if (!response.ok) throw new Error(`Amazon PA API error: ${response.status}`);
    const data = await response.json();

    const items = Array.isArray(data?.SearchResult?.Items) ? data.SearchResult.Items : [];

    return items.map((item: Record<string, unknown>) => {
      const raw = item as Record<string, any>;
      return {
      source: "amazon",
      productId: String(raw.ASIN ?? ""),
      title: String(raw?.ItemInfo?.Title?.DisplayValue ?? ""),
      url: String(raw?.DetailPageURL ?? ""),
      imageUrl:
        typeof raw?.Images?.Primary?.Medium?.URL === "string"
          ? raw.Images.Primary.Medium.URL
          : undefined,
      price: parseMoney(
        String(raw?.Offers?.Listings?.[0]?.Price?.DisplayAmount ?? ""),
        query.currency ?? config.defaultCurrency
      ),
      moq: undefined,
      supplierName: "Amazon",
      supplierRating: undefined,
      location: undefined,
      updatedAt: ctx.now,
      raw: item,
      };
    });
  },
};
