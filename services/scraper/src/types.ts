export type SourceId =
  | "alibaba"
  | "1688"
  | "indiamart"
  | "madeinchina"
  | "amazon"
  | "dhgate"
  | "tradekey"
  | "globalsources"
  | "generic"
  | "custom";

export type Money = {
  amount: number;
  currency: string;
};

export type ShippingInfo = {
  cost?: Money;
  etaDays?: number;
};

export type NormalizedProduct = {
  source: SourceId;
  productId?: string;
  title: string;
  url: string;
  imageUrl?: string;
  price?: Money;
  moq?: number;
  supplierName?: string;
  supplierRating?: number;
  location?: string;
  shipping?: ShippingInfo;
  availability?: string;
  updatedAt: string;
  raw?: Record<string, unknown>;
};

export type ScrapeQuery = {
  source: SourceId;
  query: string;
  targetUrl?: string;
  selectors?: {
    item: string;
    title: string;
    price?: string;
    url?: string;
    image?: string;
  };
  limit?: number;
  currency?: string;
  region?: string;
  useBrowser?: boolean;
};

export type ScrapeResult = {
  source: SourceId;
  query: string;
  items: NormalizedProduct[];
  tookMs: number;
  cached: boolean;
};
