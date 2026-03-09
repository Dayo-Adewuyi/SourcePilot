import { z } from "zod";

// ═══════════════════════════════════════════════════════════════
// Shared config schema for all SourcePilot CRE workflows
// Validated at startup via Zod — any missing field fails fast
// ═══════════════════════════════════════════════════════════════

const evmConfigSchema = z.object({
  chainSelectorName: z.string(),
  isTestnet: z.boolean(),
});

export const priceScannerConfigSchema = z.object({
  schedule: z.string(), // Cron expression e.g. "0 */30 * * * *"
  scraperBaseUrl: z.string(), // SourcePilot scraper service URL
  aiServiceUrl: z.string(), // Claude AI analysis service URL
  priceOracleAddress: z.string(), // PriceOracle.sol contract address
  agentRegistryAddress: z.string(), // AgentRegistry.sol contract address
  evm: evmConfigSchema,
  maxProductsPerScan: z.number(),
  maxEntriesPerProduct: z.number(),
});

export const dealExecutorConfigSchema = z.object({
  scraperBaseUrl: z.string(),
  aiServiceUrl: z.string(),
  escrowVaultAddress: z.string(),
  purchaseOrderAddress: z.string(),
  agentRegistryAddress: z.string(),
  logisticsApiUrl: z.string(), // Freightos/ShipEngine booking endpoint
  evm: evmConfigSchema,
});

export const deliveryVerifierConfigSchema = z.object({
  schedule: z.string(), // e.g. "0 0 */6 * * *" (every 6 hours)
  trackingApiUrl: z.string(), // ShipEngine tracking endpoint
  escrowVaultAddress: z.string(),
  purchaseOrderAddress: z.string(),
  agentRegistryAddress: z.string(),
  evm: evmConfigSchema,
  maxDealsPerScan: z.number(),
});

export type PriceScannerConfig = z.infer<typeof priceScannerConfigSchema>;
export type DealExecutorConfig = z.infer<typeof dealExecutorConfigSchema>;
export type DeliveryVerifierConfig = z.infer<typeof deliveryVerifierConfigSchema>;
