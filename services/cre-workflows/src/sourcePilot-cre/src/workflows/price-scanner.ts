/**
 * ═══════════════════════════════════════════════════════════════
 * WORKFLOW 1: PRICE SCANNER
 * ═══════════════════════════════════════════════════════════════
 *
 * Trigger:  Cron (every 30 minutes, configurable)
 * Flow:
 *   1. Read active agents from AgentRegistry (EVM Read)
 *   2. For each agent's product categories:
 *      a. Hit SourcePilot scraper service (HTTP POST via NodeMode)
 *      b. Send results to AI service for ranking (HTTP POST via NodeMode)
 *   3. Batch-write top deals to PriceOracle contract (EVM Write)
 *
 * Security:
 *   - API keys accessed via CRE secrets (never hardcoded)
 *   - HTTP calls use cacheSettings to prevent duplicate requests
 *   - All data consensus-verified across DON nodes
 *   - Deterministic execution: no Date.now(), no random, sorted keys
 */

import {
  cre,
  Runner,
  consensusIdenticalAggregation,
  ConsensusAggregationByFields,
  identical,
  hexToBase64,
  bytesToHex,
  encodeCallMsg,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  type Runtime,
  type NodeRuntime,
  type SecretsProvider,
  type CronPayload,
} from "@chainlink/cre-sdk";
import {
  encodeFunctionData,
  decodeFunctionResult,
  keccak256,
  toHex,
  toBytes,
  zeroAddress,
  type Address,
} from "viem";
import { z } from "zod";
import { PriceOracleAbi, AgentRegistryAbi } from "../contracts/abi/index.js";
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

const scrapeSuppliers = (
  nodeRuntime: NodeRuntime<PriceScannerConfig>
): ScanResult => {
  const config = nodeRuntime.config;
  const httpClient = new cre.capabilities.HTTPClient();

  // 1. Read active agent categories from registry
  //    (We pass categories via config for now — in production,
  //     read from AgentRegistry via EVM in DON mode before entering NodeMode)
  const categories = ["phone-cases", "screen-protectors", "charging-cables"];

  const allProductHashes: string[] = [];
  const allEntries: AnalyzedSupplier[] = [];
  const entryCounts: number[] = [];

  for (const category of categories.slice(0, config.maxProductsPerScan)) {
    // 2. Hit SourcePilot scraper
    const scrapeBody = JSON.stringify({
      source: "alibaba",
      query: category,
      limit: 20,
    });

    const scrapeResponse = httpClient
      .sendRequest(nodeRuntime, {
        url: `${config.scraperBaseUrl}/scrape`,
        method: "POST" as const,
        body: Buffer.from(scrapeBody).toString("base64"),
        headers: {
          "Content-Type": "application/json",
        },
        cacheSettings: {
          store: true,
          maxAge: "120s", // 2 min cache — prevents duplicate scrapes across nodes
        },
      })
      .result();

    if (scrapeResponse.statusCode !== 200) {
      // Log and skip this category — don't fail entire workflow
      nodeRuntime.log(
        `[PriceScanner] Scrape failed for "${category}": HTTP ${scrapeResponse.statusCode}`
      );
      continue;
    }

    const products: ScrapedProduct[] = JSON.parse(
      new TextDecoder().decode(scrapeResponse.body)
    );

    if (products.length === 0) {
      nodeRuntime.log(`[PriceScanner] No products found for "${category}"`);
      continue;
    }

    // 3. Send to AI service for analysis + scoring
    const analyzeBody = JSON.stringify({
      products,
      agentPreferences: {
        minOrderSize: 50,
        maxOrderSize: 10000,
        categories: [category],
      },
    });

    const aiResponse = httpClient
      .sendRequest(nodeRuntime, {
        url: `${config.aiServiceUrl}/analyze-suppliers`,
        method: "POST" as const,
        body: Buffer.from(analyzeBody).toString("base64"),
        headers: {
          "Content-Type": "application/json",
        },
        cacheSettings: {
          store: true,
          maxAge: "120s",
        },
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

    // 4. Compute product hash deterministically
    const productHash = keccak256(toBytes(category));

    // Take top N entries (already sorted by AI service)
    const topEntries = analyzed.slice(0, config.maxEntriesPerProduct);

    if (topEntries.length > 0) {
      allProductHashes.push(productHash);
      entryCounts.push(topEntries.length);

      for (const entry of topEntries) {
        allEntries.push({
          ...entry,
          productHash,
        });
      }
    }
  }

  return {
    productHashes: allProductHashes,
    allEntries,
    entryCounts,
  };
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

  // Get network for Base
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.evm.chainSelectorName,
    isTestnet: config.evm.isTestnet,
  });
  if (!network) {
    throw new Error(`Network not found: ${config.evm.chainSelectorName}`);
  }

  const evmClient = new cre.capabilities.EVMClient(
    network.chainSelector.selector
  );

  // ── Step 1: Scrape + Analyze in NodeMode with consensus ──
  // Each DON node independently scrapes and analyzes.
  // ConsensusIdenticalAggregation ensures all nodes agree on the result
  // (possible because cacheSettings ensures they all see the same HTTP responses)
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
    `[PriceScanner] Found deals for ${scanResult.productHashes.length} products, ${scanResult.allEntries.length} total entries`
  );

  // ── Step 2: Write to PriceOracle on-chain ──
  // Convert analyzed results to contract-compatible format
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

  // Generate signed report
  const report = runtime
    .report({
      encodedPayload: hexToBase64(callData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  // Submit on-chain
  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: config.priceOracleAddress,
      report: report,
    })
    .result();

  runtime.log(
    `[PriceScanner] PriceOracle updated. TX status: ${writeResult.txStatus}`
  );

  return `Updated ${scanResult.productHashes.length} products`;
};

// ═══════════════════════════════════════════════════════════════
// WORKFLOW REGISTRATION
// ═══════════════════════════════════════════════════════════════

const initWorkflow = (config: PriceScannerConfig, _secretsProvider: SecretsProvider) => {
  const cron = new cre.capabilities.CronCapability();

  return [
    cre.handler(
      cron.trigger({ schedule: config.schedule }),
      onCronTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<PriceScannerConfig>({
    configSchema: priceScannerConfigSchema,
  });
  await runner.run(initWorkflow);
}

main();
