/**
 * ═══════════════════════════════════════════════════════════════
 * WORKFLOW 1: PRICE SCANNER
 * ═══════════════════════════════════════════════════════════════
 *
 * Trigger:  Cron (every 30 minutes, configurable)
 * Flow:
 *   1. For each product category, hit scraper + AI service (NodeMode)
 *   2. Batch-write top deals to PriceOracle contract (EVM Write)
 */

import {
  CronCapability,
  EVMClient,
  HTTPClient,
  handler,
  Runner,
  consensusIdenticalAggregation,
  hexToBase64,
  getNetwork,
  type Runtime,
  type NodeRuntime,
  type SecretsProvider,
  type CronPayload,
} from "@chainlink/cre-sdk";
import {
  encodeFunctionData,
  keccak256,
  toBytes,
} from "viem";
import { PriceOracleAbi } from "../contracts/abi/index.js";
import type { ScrapedProduct, AnalyzedSupplier } from "../lib/types.js";
import { priceScannerConfigSchema, type PriceScannerConfig } from "../lib/config.js";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface ScanResult {
  productHashes: string[];
  allEntries: AnalyzedSupplier[];
  entryCounts: number[];
}

// ═══════════════════════════════════════════════════════════════
// NODE-MODE: Scrape suppliers (runs on each DON node)
// ═══════════════════════════════════════════════════════════════

type ScraperItem = {
  source: string;
  productId?: string;
  title: string;
  url: string;
  imageUrl?: string;
  price?: { amount: number; currency: string };
  moq?: number;
  supplierName?: string;
  supplierRating?: number;
  location?: string;
};

type ScrapeResult = {
  source: string;
  query: string;
  items: ScraperItem[];
};

type BatchScrapeResponse = {
  results: ScrapeResult[];
};

type AgentConfig = {
  sources: string[];
  categories: string[];
  limit?: number;
  currency?: string;
  region?: string;
  useBrowser?: boolean;
  preferences: {
    minOrderSize: number;
    maxOrderSize: number;
  };
};

const scrapeSuppliers = (
  nodeRuntime: NodeRuntime<PriceScannerConfig>
): ScanResult => {
  const config = nodeRuntime.config;
  const httpClient = new HTTPClient();

  const agentConfigResponse = httpClient
    .sendRequest(nodeRuntime, {
      url: `${config.agentConfigUrl}/agents/${config.agentId}`,
      method: "GET" as const,
      headers: {
        ...(config.agentConfigApiKey
          ? { "x-api-key": config.agentConfigApiKey }
          : {}),
      },
      cacheSettings: { store: true, maxAge: "60s" },
    })
    .result();

  if (agentConfigResponse.statusCode !== 200) {
    nodeRuntime.log(
      `[PriceScanner] Agent config fetch failed: HTTP ${agentConfigResponse.statusCode}`
    );
    return { productHashes: [], allEntries: [], entryCounts: [] };
  }

  const agentPayload = JSON.parse(
    new TextDecoder().decode(agentConfigResponse.body)
  ) as { config: AgentConfig };

  const agentConfig = agentPayload.config;
  const categories = agentConfig.categories ?? [];
  const source = agentConfig.sources?.[0] ?? "alibaba";

  const allProductHashes: string[] = [];
  const allEntries: AnalyzedSupplier[] = [];
  const entryCounts: number[] = [];

  const targetCategories = categories.slice(
    0,
    Math.min(config.maxProductsPerScan, 3)
  );

  const batchBody = JSON.stringify({
    queries: targetCategories.map((category) => ({
      source,
      query: category,
      limit: agentConfig.limit ?? 20,
      currency: agentConfig.currency ?? "USD",
      region: agentConfig.region,
      useBrowser: agentConfig.useBrowser,
    })),
  });

  const batchResponse = httpClient
    .sendRequest(nodeRuntime, {
      url: `${config.scraperBaseUrl}/scrape/batch`,
      method: "POST" as const,
      body: Buffer.from(batchBody).toString("base64"),
      headers: { "Content-Type": "application/json" },
      cacheSettings: { store: true, maxAge: "120s" },
    })
    .result();

  if (batchResponse.statusCode !== 200) {
    nodeRuntime.log(
      `[PriceScanner] Batch scrape failed: HTTP ${batchResponse.statusCode}`
    );
    return { productHashes: [], allEntries: [], entryCounts: [] };
  }

  const batchData = JSON.parse(
    new TextDecoder().decode(batchResponse.body)
  ) as BatchScrapeResponse;

  for (const category of targetCategories) {
    const batchItem = batchData.results.find((item) => item.query === category);
    const rawItems = batchItem?.items ?? [];

    const products: ScrapedProduct[] = rawItems.map((item) => ({
      title: item.title,
      price: item.price?.amount ?? 0,
      currency: item.price?.currency ?? "USD",
      moq: item.moq ?? 0,
      supplier: item.supplierName ?? "",
      supplierRating: item.supplierRating ?? 0,
      supplierUrl: item.url,
      productUrl: item.url,
      imageUrl: item.imageUrl ?? "",
      source: item.source,
      location: item.location,
    }));

    if (products.length === 0) {
      nodeRuntime.log(`[PriceScanner] No products found for "${category}"`);
      continue;
    }

    const analyzeBody = JSON.stringify({
      products,
      agentPreferences: {
        minOrderSize: agentConfig.preferences.minOrderSize,
        maxOrderSize: agentConfig.preferences.maxOrderSize,
        categories: [category],
      },
    });

    const aiResponse = httpClient
      .sendRequest(nodeRuntime, {
        url: `${config.aiServiceUrl}/analyze-suppliers`,
        method: "POST" as const,
        body: Buffer.from(analyzeBody).toString("base64"),
        headers: { "Content-Type": "application/json" },
        cacheSettings: { store: true, maxAge: "120s" },
      })
      .result();

    if (aiResponse.statusCode !== 200) {
      nodeRuntime.log(
        `[PriceScanner] AI analysis failed for "${category}": HTTP ${aiResponse.statusCode}`
      );
      continue;
    }

    const analyzed: AnalyzedSupplier[] = JSON.parse(
      new TextDecoder().decode(aiResponse.body)
    );

    const productHash = keccak256(toBytes(category));
    const topEntries = analyzed.slice(0, config.maxEntriesPerProduct);

    if (topEntries.length > 0) {
      allProductHashes.push(productHash);
      entryCounts.push(topEntries.length);
      for (const entry of topEntries) {
        allEntries.push({ ...entry, productHash });
      }
    }
  }

  return { productHashes: allProductHashes, allEntries, entryCounts };
};

// ═══════════════════════════════════════════════════════════════
// DON-MODE: Main trigger callback
// ═══════════════════════════════════════════════════════════════

const onCronTrigger = (
  runtime: Runtime<PriceScannerConfig>,
  _trigger: CronPayload
): string => {
  const config = runtime.config;

  runtime.log("[PriceScanner] Starting scan cycle...");

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.evm.chainSelectorName,
    isTestnet: config.evm.isTestnet,
  });
  if (!network) {
    throw new Error(`Network not found: ${config.evm.chainSelectorName}`);
  }

  const evmClient = new EVMClient(network.chainSelector.selector);

  const scanResult = runtime
    .runInNodeMode(
      scrapeSuppliers,
      consensusIdenticalAggregation<ScanResult>()
    )()
    .result();

  if (scanResult.productHashes.length === 0) {
    runtime.log("[PriceScanner] No products to update. Exiting.");
    return "NoUpdates";
  }

  runtime.log(
    `[PriceScanner] Found deals for ${scanResult.productHashes.length} products`
  );

  const now = runtime.now();
  const timestamp = BigInt(Math.floor(now.getTime() / 1000));

  const contractEntries = scanResult.allEntries.map((entry) => ({
    productHash: entry.productHash as `0x${string}`,
    unitPrice: entry.unitPrice,
    moq: entry.moq,
    shippingCost: entry.shippingCost,
    supplierScore: entry.supplierScore,
    timestamp,
    supplierRef: entry.supplierRef,
  }));

  const callData = encodeFunctionData({
    abi: PriceOracleAbi,
    functionName: "batchUpdatePrices",
    args: [
      scanResult.productHashes.map((h) => h as `0x${string}`),
      contractEntries,
      scanResult.entryCounts.map((c) => BigInt(c)),
    ],
  });

  const report = runtime
    .report({
      encodedPayload: hexToBase64(callData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const writeResult = evmClient
    .writeReport(runtime, { receiver: config.priceOracleAddress, report })
    .result();

  runtime.log(`[PriceScanner] PriceOracle updated. TX: ${writeResult.txStatus}`);

  return `Updated ${scanResult.productHashes.length} products`;
};

// ═══════════════════════════════════════════════════════════════
// WORKFLOW REGISTRATION
// ═══════════════════════════════════════════════════════════════

const initWorkflow = (config: PriceScannerConfig, _secretsProvider: SecretsProvider) => {
  const cron = new CronCapability();

  return [
    handler(cron.trigger({ schedule: config.schedule }), onCronTrigger),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<PriceScannerConfig>({
    configSchema: priceScannerConfigSchema,
  });
  await runner.run(initWorkflow);
}

main();
