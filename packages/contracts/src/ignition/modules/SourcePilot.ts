import { buildModule } from "@nomicfoundation/ignition-core";

// ═══════════════════════════════════════════════════════════════
// BASE SEPOLIA USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
// BASE MAINNET USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
// ═══════════════════════════════════════════════════════════════

const SourcePilotModule = buildModule("SourcePilot", (m) => {
  // ── Parameters ──
  const usdc = m.getParameter("usdc", "0x036CbD53842c5426634e7929541eC2318f3dCF7e"); // Default: Base Sepolia
  const admin = m.getParameter("admin");
  const feeCollector = m.getParameter("feeCollector");

  // ══════════════════════════════════════════
  // 1. Deploy PriceOracle (no dependencies)
  // ══════════════════════════════════════════
  const priceOracle = m.contract("PriceOracle", [admin]);

  // ══════════════════════════════════════════
  // 2. Deploy AgentRegistry (no dependencies)
  // ══════════════════════════════════════════
  const agentRegistry = m.contract("AgentRegistry", [admin]);

  // ══════════════════════════════════════════
  // 3. Deploy EscrowVault (depends on USDC)
  // ══════════════════════════════════════════
  const escrowVault = m.contract("EscrowVault", [usdc, admin, feeCollector]);

  // ══════════════════════════════════════════
  // 4. Deploy PurchaseOrder (depends on EscrowVault)
  // ══════════════════════════════════════════
  const purchaseOrder = m.contract("PurchaseOrder", [admin, escrowVault]);

  // ══════════════════════════════════════════
  // 5. Deploy DisputeResolver (depends on USDC + EscrowVault)
  // ══════════════════════════════════════════
  const disputeResolver = m.contract("DisputeResolver", [usdc, admin, escrowVault]);

  // ══════════════════════════════════════════
  // 6. Post-deployment configuration
  // ══════════════════════════════════════════

  // EscrowVault → link PurchaseOrder
  m.call(escrowVault, "setPurchaseOrderContract", [purchaseOrder], {
    id: "escrow_setPO",
    after: [purchaseOrder],
  });

  // EscrowVault → link DisputeResolver
  m.call(escrowVault, "setDisputeResolver", [disputeResolver], {
    id: "escrow_setDR",
    after: [disputeResolver],
  });

  // AgentRegistry → authorize EscrowVault as stats updater
  m.call(agentRegistry, "setAuthorizedUpdater", [escrowVault, true], {
    id: "registry_authEscrow",
    after: [escrowVault],
  });

  return {
    priceOracle,
    agentRegistry,
    escrowVault,
    purchaseOrder,
    disputeResolver,
  };
});

export default SourcePilotModule;
