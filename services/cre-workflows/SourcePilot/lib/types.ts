// ═══════════════════════════════════════════════════════════════
// Types matching SourcePilot scraper service response schema
// ═══════════════════════════════════════════════════════════════

/** Normalized product from scraper POST /scrape response */
export interface ScrapedProduct {
  title: string;
  price: number;
  currency: string;
  moq: number;
  supplier: string;
  supplierRating: number;
  supplierUrl: string;
  productUrl: string;
  imageUrl: string;
  source: string; // "alibaba" | "indiamart" | "custom" etc.
  shippingEstimate?: number;
  location?: string;
}

/** POST /scrape request body */
export interface ScrapeRequest {
  source: string;
  query: string;
  limit: number;
}

/** POST /scrape/batch request body */
export interface BatchScrapeRequest {
  jobs: ScrapeRequest[];
}

/** AI analysis service response */
export interface AnalyzedSupplier {
  productHash: string; // hex string
  unitPrice: bigint; // USDC 6 decimals
  moq: bigint;
  shippingCost: bigint; // USDC 6 decimals
  supplierScore: bigint; // 0-10000 basis points
  supplierRef: string;
}

/** AI analysis request */
export interface AnalyzeRequest {
  products: ScrapedProduct[];
  agentPreferences: {
    minOrderSize: number;
    maxOrderSize: number;
    categories: string[];
  };
}

/** Logistics booking request */
export interface BookShipmentRequest {
  origin: string;
  destination: string;
  weight: number;
  dimensions?: { length: number; width: number; height: number };
  dealId: number;
  supplierRef: string;
}

/** Tracking status response */
export interface TrackingStatus {
  dealId: number;
  trackingNumber: string;
  carrier: string;
  status: "pending" | "in_transit" | "customs" | "delivered" | "exception";
  estimatedDelivery?: string;
  lastUpdate: string;
  location?: string;
}

/** Active deal for delivery scanning */
export interface ActiveDeal {
  dealId: number;
  agentId: number;
  amount: bigint;
  status: number;
  deliveryDeadline: number;
  metadataURI: string;
}
