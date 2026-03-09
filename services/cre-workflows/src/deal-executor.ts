/**
 * ═══════════════════════════════════════════════════════════════
 * WORKFLOW 2: DEAL EXECUTOR
 * ═══════════════════════════════════════════════════════════════
 *
 * Trigger:  EVM Log — fires on DealCreated event from EscrowVault
 * Flow:
 *   1. Parse DealCreated event data (dealId, agentId, buyer, supplier, amount)
 *   2. Read full deal details from EscrowVault (EVM Read)
 *   3. Confirm stock availability with supplier via scraper (HTTP POST)
 *   4. Assess supplier risk via AI service (HTTP POST)
 *   5. If risk acceptable: confirm deal on-chain (EVM Write)
 *   6. Book freight via logistics API (HTTP POST)
 *   7. Mark deal as shipped once booking confirmed (EVM Write)
 *
 * Security:
 *   - Secrets for logistics API keys
 *   - cacheSettings on all non-idempotent HTTP calls
 *   - Risk threshold check before confirming — AI can reject risky deals
 *   - Status checks prevent double-execution on replayed events
 */

import {
  cre,
  Runner,
  consensusIdenticalAggregation,
  hexToBase64,
  encodeCallMsg,
  bytesToHex,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  type Runtime,
  type NodeRuntime,
  type SecretsProvider,
} from "@chainlink/cre-sdk";
import {
  encodeFunctionData,
  decodeFunctionResult,
  decodeEventLog,
  keccak256,
  toBytes,
  zeroAddress,
  type Address,
} from "viem";
import { z } from "zod";
import {
  EscrowVaultAbi,
  AgentRegistryAbi,
  PurchaseOrderAbi,
  DealStatus,
} from "./index.js";
import type { BookShipmentRequest } from "./types.js";
import {
  dealExecutorConfigSchema,
  type DealExecutorConfig,
} from "./config.js";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface DealData {
  dealId: bigint;
  agentId: bigint;
  buyer: Address;
  supplier: Address;
  amount: bigint;
  platformFee: bigint;
  createdAt: bigint;
  deliveryDeadline: bigint;
  status: bigint;
  metadataURI: string;
}

interface StockCheckResult {
  available: boolean;
  riskScore: number; // 0-10000
  riskReason: string;
  bookingRef?: string;
}

// ═══════════════════════════════════════════════════════════════
// NODE-MODE: Verify stock + assess risk + book freight
// ═══════════════════════════════════════════════════════════════

const verifyAndBook = (
  nodeRuntime: NodeRuntime<DealExecutorConfig>,
  dealMetadata: {
    dealId: number;
    supplierRef: string;
    amount: number;
    metadataURI: string;
    logisticsKey: string;
    scraperKey: string;
  }
): StockCheckResult => {
  const config = nodeRuntime.config;
  const httpClient = new cre.capabilities.HTTPClient();
  const { logisticsKey, scraperKey } = dealMetadata;

  // 2. Confirm stock with supplier via scraper service
  //    SourcePilot scraper has a /scrape endpoint we can use to
  //    re-check the specific supplier listing
  const stockCheckBody = JSON.stringify({
    source: "alibaba",
    query: dealMetadata.supplierRef,
    limit: 1,
  });

  const stockResponse = httpClient
    .sendRequest(nodeRuntime, {
      url: `${config.scraperBaseUrl}/scrape`,
      method: "POST" as const,
      body: Buffer.from(stockCheckBody).toString("base64"),
      headers: {
        "Content-Type": "application/json",
        ...(scraperKey
          ? { Authorization: `Bearer ${scraperKey}` }
          : {}),
      },
      cacheSettings: {
        store: true,
        maxAge: "60s",
      },
    })
    .result();

  if (stockResponse.statusCode !== 200) {
    return {
      available: false,
      riskScore: 10_000,
      riskReason: `Stock check failed: HTTP ${stockResponse.statusCode}`,
    };
  }

  const products = JSON.parse(
    new TextDecoder().decode(stockResponse.body)
  );

  if (products.length === 0) {
    return {
      available: false,
      riskScore: 10_000,
      riskReason: "Product no longer available from supplier",
    };
  }

  // 3. AI risk assessment
  const riskBody = JSON.stringify({
    supplier: products[0],
    dealAmount: dealMetadata.amount,
  });

  const riskResponse = httpClient
    .sendRequest(nodeRuntime, {
      url: `${config.aiServiceUrl}/assess-risk`,
      method: "POST" as const,
      body: Buffer.from(riskBody).toString("base64"),
      headers: { "Content-Type": "application/json" },
      cacheSettings: {
        store: true,
        maxAge: "60s",
      },
    })
    .result();

  let riskScore = 5_000; // Default: medium risk
  let riskReason = "Unable to assess";

  if (riskResponse.statusCode === 200) {
    const riskData = JSON.parse(
      new TextDecoder().decode(riskResponse.body)
    );
    riskScore = riskData.riskScore;
    riskReason = riskData.reason;
  }

  // 4. If risk acceptable, book freight
  if (riskScore > 7_500) {
    return {
      available: true,
      riskScore,
      riskReason: `High risk rejected: ${riskReason}`,
    };
  }

  const bookingBody = JSON.stringify({
    origin: products[0].location || "Shenzhen, China",
    destination: "To be configured", // From agent config
    weight: 10, // Estimated
    dealId: dealMetadata.dealId,
    supplierRef: dealMetadata.supplierRef,
  } as BookShipmentRequest);

  const bookingResponse = httpClient
    .sendRequest(nodeRuntime, {
      url: `${config.logisticsApiUrl}/book`,
      method: "POST" as const,
      body: Buffer.from(bookingBody).toString("base64"),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${logisticsKey}`,
      },
      cacheSettings: {
        store: true,
        maxAge: "300s", // 5 min — booking is expensive
      },
    })
    .result();

  let bookingRef: string | undefined;
  if (bookingResponse.statusCode === 200 || bookingResponse.statusCode === 201) {
    const bookingData = JSON.parse(
      new TextDecoder().decode(bookingResponse.body)
    );
    bookingRef = bookingData.trackingNumber || bookingData.bookingId;
  }

  return {
    available: true,
    riskScore,
    riskReason,
    bookingRef,
  };
};

// ═══════════════════════════════════════════════════════════════
// DON-MODE: Main trigger callback (EVM Log)
// ═══════════════════════════════════════════════════════════════

const onDealCreated = (runtime: Runtime<DealExecutorConfig>): string => {
  const config = runtime.config;

  runtime.log("[DealExecutor] DealCreated event received");

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.evm.chainSelectorName,
    isTestnet: config.evm.isTestnet,
  });
  if (!network) throw new Error(`Network not found: ${config.evm.chainSelectorName}`);

  const evmClient = new cre.capabilities.EVMClient(
    network.chainSelector.selector
  );

  // ── Step 1: Read deal details from EscrowVault ──
  // The trigger event data contains the dealId, but we read full details
  // from on-chain for authoritative data
  const getNextDealCallData = encodeFunctionData({
    abi: EscrowVaultAbi,
    functionName: "nextDealId",
  });

  const nextDealResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: config.escrowVaultAddress as Address,
        data: getNextDealCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  const nextDealId = decodeFunctionResult({
    abi: EscrowVaultAbi,
    functionName: "nextDealId",
    data: bytesToHex(nextDealResult.data) as `0x${string}`,
  });

  // Process the latest deal (nextDealId - 1)
  const dealId = Number(nextDealId) - 1;
  if (dealId < 1) {
    runtime.log("[DealExecutor] No deals found");
    return "NoDeal";
  }

  const getDealCallData = encodeFunctionData({
    abi: EscrowVaultAbi,
    functionName: "getDeal",
    args: [BigInt(dealId)],
  });

  const dealResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: config.escrowVaultAddress as Address,
        data: getDealCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  const deal = decodeFunctionResult({
    abi: EscrowVaultAbi,
    functionName: "getDeal",
    data: bytesToHex(dealResult.data) as `0x${string}`,
  }) as DealData;

  // Safety: only process Locked deals
  if (Number(deal.status) !== DealStatus.Locked) {
    runtime.log(
      `[DealExecutor] Deal ${dealId} is not Locked (status=${deal.status}). Skipping.`
    );
    return "SkippedNotLocked";
  }

  runtime.log(
    `[DealExecutor] Processing deal #${dealId}: ${deal.amount} USDC`
  );

  // ── Step 2: Verify + Book in NodeMode ──
  const logisticsKey = runtime.getSecret({ id: "LOGISTICS_API_KEY" }).result().value;
  const scraperKey = runtime.getSecret({ id: "SCRAPER_API_KEY" }).result().value;

  const checkResult = runtime
    .runInNodeMode(
      (nodeRuntime: NodeRuntime<DealExecutorConfig>) =>
        verifyAndBook(nodeRuntime, {
          dealId,
          supplierRef: deal.metadataURI,
          amount: Number(deal.amount),
          metadataURI: deal.metadataURI,
          logisticsKey,
          scraperKey,
        }),
      consensusIdenticalAggregation<StockCheckResult>()
    )()
    .result();

  // ── Step 3: Risk gate — reject if too risky ──
  if (!checkResult.available || checkResult.riskScore > 7_500) {
    runtime.log(
      `[DealExecutor] Deal #${dealId} rejected: ${checkResult.riskReason}`
    );
    // Don't confirm — buyer can cancel the Locked deal themselves
    return `Rejected: ${checkResult.riskReason}`;
  }

  // ── Step 4: Confirm deal on-chain ──
  const confirmCallData = encodeFunctionData({
    abi: EscrowVaultAbi,
    functionName: "confirmDeal",
    args: [BigInt(dealId)],
  });

  const confirmReport = runtime
    .report({
      encodedPayload: hexToBase64(confirmCallData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const confirmResult = evmClient
    .writeReport(runtime, {
      receiver: config.escrowVaultAddress,
      report: confirmReport,
    })
    .result();

  runtime.log(
    `[DealExecutor] Deal #${dealId} confirmed. TX: ${confirmResult.txStatus}`
  );

  // ── Step 5: If freight booked, mark as shipped ──
  if (checkResult.bookingRef) {
    const shipCallData = encodeFunctionData({
      abi: EscrowVaultAbi,
      functionName: "markShipped",
      args: [BigInt(dealId)],
    });

    const shipReport = runtime
      .report({
        encodedPayload: hexToBase64(shipCallData),
        encoderName: "evm",
        signingAlgo: "ecdsa",
        hashingAlgo: "keccak256",
      })
      .result();

    evmClient
      .writeReport(runtime, {
        receiver: config.escrowVaultAddress,
        report: shipReport,
      })
      .result();

    runtime.log(
      `[DealExecutor] Deal #${dealId} shipped. Tracking: ${checkResult.bookingRef}`
    );
  }

  return `Deal #${dealId} executed successfully`;
};

// ═══════════════════════════════════════════════════════════════
// WORKFLOW REGISTRATION
// ═══════════════════════════════════════════════════════════════

const initWorkflow = (config: DealExecutorConfig, _secretsProvider: SecretsProvider) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.evm.chainSelectorName,
    isTestnet: config.evm.isTestnet,
  });
  if (!network) throw new Error("Network not found");

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);

  return [
    cre.handler(
      evmClient.logTrigger({
        addresses: [config.escrowVaultAddress],
        topics: [{ values: [keccak256(toBytes("DealCreated(uint256,uint256,address,address,uint256)"))] }],
      }),
      onDealCreated
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<DealExecutorConfig>({
    configSchema: dealExecutorConfigSchema,
  });
  await runner.run(initWorkflow);
}

main();
