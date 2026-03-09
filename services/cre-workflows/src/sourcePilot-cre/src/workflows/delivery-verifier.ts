/**
 * ═══════════════════════════════════════════════════════════════
 * WORKFLOW 3: DELIVERY VERIFIER
 * ═══════════════════════════════════════════════════════════════
 *
 * Trigger:  Cron (every 6 hours, configurable)
 * Flow:
 *   1. Read all Shipped deals from EscrowVault (EVM Read, scan by ID range)
 *   2. For each shipped deal, poll tracking API (HTTP GET via NodeMode)
 *   3. If delivered: confirmDelivery on-chain → releases escrow (EVM Write)
 *   4. Record deal completion stats on AgentRegistry (EVM Write)
 *   5. If anomaly detected: log warning (future: trigger alert)
 *
 * Security:
 *   - Tracking API keys via CRE secrets
 *   - Only transitions Shipped → Delivered (never skips states)
 *   - Anomaly detection flags suspicious patterns
 *   - Deterministic: sorted deal IDs, no random operations
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
  type CronPayload,
} from "@chainlink/cre-sdk";
import {
  encodeFunctionData,
  decodeFunctionResult,
  zeroAddress,
  type Address,
} from "viem";
import { z } from "zod";
import {
  EscrowVaultAbi,
  AgentRegistryAbi,
  DealStatus,
} from "../contracts/abi/index.js";
import type { TrackingStatus, ActiveDeal } from "../lib/types.js";
import {
  deliveryVerifierConfigSchema,
  type DeliveryVerifierConfig,
} from "../lib/config.js";

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

interface DeliveryCheckResult {
  dealId: number;
  isDelivered: boolean;
  isAnomaly: boolean;
  anomalyReason?: string;
  trackingStatus: string;
}

interface BatchTrackingResult {
  results: DeliveryCheckResult[];
}

// ═══════════════════════════════════════════════════════════════
// NODE-MODE: Check tracking status for all shipped deals
// ═══════════════════════════════════════════════════════════════

const checkAllDeliveries = (
  nodeRuntime: NodeRuntime<DeliveryVerifierConfig>,
  shippedDealIds: number[],
  trackingKey: string
): BatchTrackingResult => {
  const config = nodeRuntime.config;
  const httpClient = new cre.capabilities.HTTPClient();

  const results: DeliveryCheckResult[] = [];

  // Process each shipped deal — iterate in deterministic order (already sorted)
  for (const dealId of shippedDealIds) {
    const trackingResponse = httpClient
      .sendRequest(nodeRuntime, {
        url: `${config.trackingApiUrl}/track/${dealId}`,
        method: "GET" as const,
        headers: {
          Authorization: `Bearer ${trackingKey}`,
          "Content-Type": "application/json",
        },
        cacheSettings: {
          store: true,
          maxAge: "300s", // 5 min cache — tracking doesn't change rapidly
        },
      })
      .result();

    if (trackingResponse.statusCode !== 200) {
      // Can't track this deal — skip, try next cycle
      results.push({
        dealId,
        isDelivered: false,
        isAnomaly: false,
        trackingStatus: `tracking_unavailable_${trackingResponse.statusCode}`,
      });
      continue;
    }

    const tracking: TrackingStatus = JSON.parse(
      new TextDecoder().decode(trackingResponse.body)
    );

    // Determine delivery status
    const isDelivered = tracking.status === "delivered";

    // Anomaly detection: simple heuristics
    // (In production, send to AI /anomaly-detect endpoint)
    let isAnomaly = false;
    let anomalyReason: string | undefined;

    if (tracking.status === "exception") {
      isAnomaly = true;
      anomalyReason = `Shipment exception: ${tracking.location || "unknown location"}`;
    }

    results.push({
      dealId,
      isDelivered,
      isAnomaly,
      anomalyReason,
      trackingStatus: tracking.status,
    });
  }

  return { results };
};

// ═══════════════════════════════════════════════════════════════
// DON-MODE: Main trigger callback
// ═══════════════════════════════════════════════════════════════

const onCronTrigger = (
  runtime: Runtime<DeliveryVerifierConfig>,
  _trigger: CronPayload
): string => {
  const config = runtime.config;

  runtime.log("[DeliveryVerifier] Starting delivery check cycle...");

  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.evm.chainSelectorName,
    isTestnet: config.evm.isTestnet,
  });
  if (!network) throw new Error(`Network not found: ${config.evm.chainSelectorName}`);

  const evmClient = new cre.capabilities.EVMClient(
    network.chainSelector.selector
  );

  // ── Step 1: Find all Shipped deals ──
  // Read nextDealId to know the range
  const nextDealCallData = encodeFunctionData({
    abi: EscrowVaultAbi,
    functionName: "nextDealId",
  });

  const nextDealResult = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: config.escrowVaultAddress as Address,
        data: nextDealCallData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  const nextDealId = Number(
    decodeFunctionResult({
      abi: EscrowVaultAbi,
      functionName: "nextDealId",
      data: bytesToHex(nextDealResult.data) as `0x${string}`,
    })
  );

  // Scan recent deals for Shipped status
  const shippedDealIds: number[] = [];
  const dealAgentMap: Map<number, number> = new Map();

  // Scan backwards from latest deal, up to maxDealsPerScan
  const scanStart = Math.max(1, nextDealId - config.maxDealsPerScan);

  for (let dealId = scanStart; dealId < nextDealId; dealId++) {
    const statusCallData = encodeFunctionData({
      abi: EscrowVaultAbi,
      functionName: "getDealStatus",
      args: [BigInt(dealId)],
    });

    const statusResult = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: config.escrowVaultAddress as Address,
          data: statusCallData,
        }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result();

    const status = Number(
      decodeFunctionResult({
        abi: EscrowVaultAbi,
        functionName: "getDealStatus",
        data: bytesToHex(statusResult.data) as `0x${string}`,
      })
    );

    if (status === DealStatus.Shipped) {
      shippedDealIds.push(dealId);

      // Also read agentId for stats recording
      const dealCallData = encodeFunctionData({
        abi: EscrowVaultAbi,
        functionName: "getDeal",
        args: [BigInt(dealId)],
      });

      const dealDetailResult = evmClient
        .callContract(runtime, {
          call: encodeCallMsg({
            from: zeroAddress,
            to: config.escrowVaultAddress as Address,
            data: dealCallData,
          }),
          blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
        })
        .result();

      const dealDetail = decodeFunctionResult({
        abi: EscrowVaultAbi,
        functionName: "getDeal",
        data: bytesToHex(dealDetailResult.data) as `0x${string}`,
      }) as DealData;

      dealAgentMap.set(dealId, Number(dealDetail.agentId));
    }
  }

  if (shippedDealIds.length === 0) {
    runtime.log("[DeliveryVerifier] No shipped deals to verify.");
    return "NoShippedDeals";
  }

  // Sort for deterministic processing
  shippedDealIds.sort((a, b) => a - b);

  runtime.log(
    `[DeliveryVerifier] Checking ${shippedDealIds.length} shipped deals`
  );

  // ── Step 2: Check tracking in NodeMode ──
  const trackingKey = runtime.getSecret({ id: "TRACKING_API_KEY" }).result().value;

  const trackingResults = runtime
    .runInNodeMode(
      (nodeRuntime: NodeRuntime<DeliveryVerifierConfig>) =>
        checkAllDeliveries(nodeRuntime, shippedDealIds, trackingKey),
      consensusIdenticalAggregation<BatchTrackingResult>()
    )()
    .result();

  // ── Step 3: Process results — confirm deliveries on-chain ──
  let deliveredCount = 0;
  let anomalyCount = 0;

  for (const result of trackingResults.results) {
    // Log anomalies
    if (result.isAnomaly) {
      anomalyCount++;
      runtime.log(
        `[DeliveryVerifier] ANOMALY deal #${result.dealId}: ${result.anomalyReason}`
      );
      // Future: trigger notification webhook
    }

    // Confirm delivered deals
    if (result.isDelivered) {
      const confirmCallData = encodeFunctionData({
        abi: EscrowVaultAbi,
        functionName: "confirmDelivery",
        args: [BigInt(result.dealId)],
      });

      const deliveryReport = runtime
        .report({
          encodedPayload: hexToBase64(confirmCallData),
          encoderName: "evm",
          signingAlgo: "ecdsa",
          hashingAlgo: "keccak256",
        })
        .result();

      const writeResult = evmClient
        .writeReport(runtime, {
          receiver: config.escrowVaultAddress,
          report: deliveryReport,
        })
        .result();

      runtime.log(
        `[DeliveryVerifier] Deal #${result.dealId} delivered → escrow released. TX: ${writeResult.txStatus}`
      );

      // ── Step 4: Record agent stats ──
      const agentId = dealAgentMap.get(result.dealId);
      if (agentId) {
        // Read deal amount for volume tracking
        const dealCallData = encodeFunctionData({
          abi: EscrowVaultAbi,
          functionName: "getDeal",
          args: [BigInt(result.dealId)],
        });

        const dealResult = evmClient
          .callContract(runtime, {
            call: encodeCallMsg({
              from: zeroAddress,
              to: config.agentRegistryAddress as Address,
              data: encodeFunctionData({
                abi: AgentRegistryAbi,
                functionName: "recordDealCompletion",
                args: [BigInt(agentId), 0n, true], // volume will be read from deal
              }),
            }),
            blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
          })
          .result();

        // Write stats update
        const statsCallData = encodeFunctionData({
          abi: AgentRegistryAbi,
          functionName: "recordDealCompletion",
          args: [BigInt(agentId), 0n, true],
        });

        const statsReport = runtime
          .report({
            encodedPayload: hexToBase64(statsCallData),
            encoderName: "evm",
            signingAlgo: "ecdsa",
            hashingAlgo: "keccak256",
          })
          .result();

        evmClient
          .writeReport(runtime, {
            receiver: config.agentRegistryAddress,
            report: statsReport,
          })
          .result();
      }

      deliveredCount++;
    }
  }

  const summary = `Delivered: ${deliveredCount}, Anomalies: ${anomalyCount}, Pending: ${shippedDealIds.length - deliveredCount}`;
  runtime.log(`[DeliveryVerifier] Cycle complete. ${summary}`);

  return summary;
};

// ═══════════════════════════════════════════════════════════════
// WORKFLOW REGISTRATION
// ═══════════════════════════════════════════════════════════════

const initWorkflow = (config: DeliveryVerifierConfig, _secretsProvider: SecretsProvider) => {
  const cron = new cre.capabilities.CronCapability();

  return [
    cre.handler(
      cron.trigger({ schedule: config.schedule }),
      onCronTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<DeliveryVerifierConfig>({
    configSchema: deliveryVerifierConfigSchema,
  });
  await runner.run(initWorkflow);
}

main();
