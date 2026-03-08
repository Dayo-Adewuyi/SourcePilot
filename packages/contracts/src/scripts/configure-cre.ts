/**
 * SourcePilot: Configure CRE Workflow Authorization
 *
 * Run this script AFTER deploying CRE workflows to authorize
 * workflow addresses on the smart contracts.
 *
 * Usage:
 *   npx hardhat run scripts/configure-cre.ts --network baseSepolia
 *
 * Required .env variables:
 *   CRE_PRICE_SCANNER_ADDRESS
 *   CRE_DEAL_EXECUTOR_ADDRESS
 *   CRE_DELIVERY_VERIFIER_ADDRESS
 *   ARBITRATOR_ADDRESS
 */

import { network } from "hardhat";

const { ethers } = await network.connect();

// ── Load deployed addresses from ignition ──
// These should match your Ignition deployment output
const DEPLOYED = {
  escrowVault: process.env.ESCROW_VAULT_ADDRESS!,
  agentRegistry: process.env.AGENT_REGISTRY_ADDRESS!,
  priceOracle: process.env.PRICE_ORACLE_ADDRESS!,
  disputeResolver: process.env.DISPUTE_RESOLVER_ADDRESS!,
};

// ── CRE workflow addresses ──
const CRE = {
  priceScanner: process.env.CRE_PRICE_SCANNER_ADDRESS!,
  dealExecutor: process.env.CRE_DEAL_EXECUTOR_ADDRESS!,
  deliveryVerifier: process.env.CRE_DELIVERY_VERIFIER_ADDRESS!,
};

const ARBITRATOR = process.env.ARBITRATOR_ADDRESS!;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Configuring CRE authorization with account:", deployer.address);

  // ══════════════════════════════════════════
  // 1. EscrowVault: Authorize all 3 CRE workflows
  // ══════════════════════════════════════════
  console.log("\n--- EscrowVault ---");
  const escrow = await ethers.getContractAt("EscrowVault", DEPLOYED.escrowVault);

  console.log("  Authorizing Price Scanner workflow...");
  await (await escrow.setAuthorizedWorkflow(CRE.priceScanner, true)).wait();

  console.log("  Authorizing Deal Executor workflow...");
  await (await escrow.setAuthorizedWorkflow(CRE.dealExecutor, true)).wait();

  console.log("  Authorizing Delivery Verifier workflow...");
  await (await escrow.setAuthorizedWorkflow(CRE.deliveryVerifier, true)).wait();

  // ══════════════════════════════════════════
  // 2. AgentRegistry: Authorize Deal Executor for stats
  // ══════════════════════════════════════════
  console.log("\n--- AgentRegistry ---");
  const registry = await ethers.getContractAt("AgentRegistry", DEPLOYED.agentRegistry);

  console.log("  Authorizing Deal Executor as stats updater...");
  await (await registry.setAuthorizedUpdater(CRE.dealExecutor, true)).wait();

  console.log("  Authorizing Delivery Verifier as stats updater...");
  await (await registry.setAuthorizedUpdater(CRE.deliveryVerifier, true)).wait();

  // ══════════════════════════════════════════
  // 3. PriceOracle: Authorize Price Scanner
  // ══════════════════════════════════════════
  console.log("\n--- PriceOracle ---");
  const oracle = await ethers.getContractAt("PriceOracle", DEPLOYED.priceOracle);

  console.log("  Authorizing Price Scanner as updater...");
  await (await oracle.setAuthorizedUpdater(CRE.priceScanner, true)).wait();

  // ══════════════════════════════════════════
  // 4. DisputeResolver: Set arbitrator
  // ══════════════════════════════════════════
  console.log("\n--- DisputeResolver ---");
  const dispute = await ethers.getContractAt("DisputeResolver", DEPLOYED.disputeResolver);

  console.log("  Setting arbitrator...");
  await (await dispute.setArbitrator(ARBITRATOR, true)).wait();

  console.log("\n✅ CRE workflow authorization complete!");
  console.log("\nAuthorized workflows:");
  console.log(`  Price Scanner:     ${CRE.priceScanner}`);
  console.log(`  Deal Executor:     ${CRE.dealExecutor}`);
  console.log(`  Delivery Verifier: ${CRE.deliveryVerifier}`);
  console.log(`  Arbitrator:        ${ARBITRATOR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
