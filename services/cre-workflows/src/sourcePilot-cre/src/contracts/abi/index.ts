import { parseAbi } from "viem";

// ═══════════════════════════════════════════════════════════════
// Contract ABIs (only the functions CRE workflows need)
// Keep minimal — smaller WASM binary, faster execution
// ═══════════════════════════════════════════════════════════════

export const PriceOracleAbi = parseAbi([
  "function updatePrice(bytes32 productHash, tuple(bytes32 productHash, uint256 unitPrice, uint256 moq, uint256 shippingCost, uint256 supplierScore, uint256 timestamp, string supplierRef)[] entries) external",
  "function batchUpdatePrices(bytes32[] productHashes, tuple(bytes32 productHash, uint256 unitPrice, uint256 moq, uint256 shippingCost, uint256 supplierScore, uint256 timestamp, string supplierRef)[] allEntries, uint256[] entryCounts) external",
  "function getEntryCount(bytes32 productHash) external view returns (uint256)",
  "function isPriceFresh(bytes32 productHash) external view returns (bool)",
  "function computeProductHash(string productId) external pure returns (bytes32)",
]);

export const EscrowVaultAbi = parseAbi([
  "function getDeal(uint256 dealId) external view returns (tuple(uint256 dealId, uint256 agentId, address buyer, address supplier, uint256 amount, uint256 platformFee, uint256 createdAt, uint256 deliveryDeadline, uint8 status, string metadataURI))",
  "function getDealStatus(uint256 dealId) external view returns (uint8)",
  "function confirmDeal(uint256 dealId) external",
  "function markShipped(uint256 dealId) external",
  "function confirmDelivery(uint256 dealId) external",
  "function nextDealId() external view returns (uint256)",
  "event DealCreated(uint256 indexed dealId, uint256 indexed agentId, address indexed buyer, address supplier, uint256 amount)",
  "event DealApproved(uint256 indexed dealId)",
]);

export const AgentRegistryAbi = parseAbi([
  "function getAgent(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, string[] productCategories, uint256 minOrderSize, uint256 maxOrderSize, bool active, uint256 createdAt, uint256 totalDeals, uint256 totalVolume, uint256 successRate), string[] categories)",
  "function isAgentActive(uint256 agentId) external view returns (bool)",
  "function getAgentsByOwner(address owner) external view returns (uint256[])",
  "function recordDealCompletion(uint256 agentId, uint256 volume, bool success) external",
  "function nextAgentId() external view returns (uint256)",
]);

export const PurchaseOrderAbi = parseAbi([
  "function mintPurchaseOrder(address to, uint256 dealId, string metadataURI, bool soulbound) external returns (uint256)",
  "function updateStatus(uint256 dealId, uint8 newStatus) external",
  "function getPOByDeal(uint256 dealId) external view returns (uint256 tokenId, address owner, uint8 status, string metadataURI)",
]);

// ═══════════════════════════════════════════════════════════════
// Deal status enum (mirrors Solidity)
// ═══════════════════════════════════════════════════════════════

export const DealStatus = {
  None: 0,
  Locked: 1,
  Confirmed: 2,
  Shipped: 3,
  Delivered: 4,
  Completed: 5,
  Disputed: 6,
  Refunded: 7,
  Cancelled: 8,
} as const;
