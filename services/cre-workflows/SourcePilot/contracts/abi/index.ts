// ═══════════════════════════════════════════════════════════════
// Contract ABIs (only the functions CRE workflows need)
// Keep minimal — smaller WASM binary, faster execution
// Using raw ABI arrays instead of parseAbi() to avoid issues
// with top-level execution in the CRE WASM environment.
// ═══════════════════════════════════════════════════════════════

export const PriceOracleAbi = [
  {
    type: "function",
    name: "updatePrice",
    inputs: [
      { name: "productHash", type: "bytes32" },
      {
        name: "entries",
        type: "tuple[]",
        components: [
          { name: "productHash", type: "bytes32" },
          { name: "unitPrice", type: "uint256" },
          { name: "moq", type: "uint256" },
          { name: "shippingCost", type: "uint256" },
          { name: "supplierScore", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "supplierRef", type: "string" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "batchUpdatePrices",
    inputs: [
      { name: "productHashes", type: "bytes32[]" },
      {
        name: "allEntries",
        type: "tuple[]",
        components: [
          { name: "productHash", type: "bytes32" },
          { name: "unitPrice", type: "uint256" },
          { name: "moq", type: "uint256" },
          { name: "shippingCost", type: "uint256" },
          { name: "supplierScore", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "supplierRef", type: "string" },
        ],
      },
      { name: "entryCounts", type: "uint256[]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getEntryCount",
    inputs: [{ name: "productHash", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isPriceFresh",
    inputs: [{ name: "productHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "computeProductHash",
    inputs: [{ name: "productId", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "pure",
  },
] as const;

export const EscrowVaultAbi = [
  {
    type: "function",
    name: "getDeal",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "dealId", type: "uint256" },
          { name: "agentId", type: "uint256" },
          { name: "buyer", type: "address" },
          { name: "supplier", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "platformFee", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "deliveryDeadline", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getDealStatus",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "confirmDeal",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "markShipped",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "confirmDelivery",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "nextDealId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "DealCreated",
    inputs: [
      { name: "dealId", type: "uint256", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "supplier", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DealApproved",
    inputs: [{ name: "dealId", type: "uint256", indexed: true }],
  },
] as const;

export const AgentRegistryAbi = [
  {
    type: "function",
    name: "getAgent",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "agentId", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "productCategories", type: "string[]" },
          { name: "minOrderSize", type: "uint256" },
          { name: "maxOrderSize", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "createdAt", type: "uint256" },
          { name: "totalDeals", type: "uint256" },
          { name: "totalVolume", type: "uint256" },
          { name: "successRate", type: "uint256" },
        ],
      },
      { name: "categories", type: "string[]" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isAgentActive",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentsByOwner",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "recordDealCompletion",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "volume", type: "uint256" },
      { name: "success", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "nextAgentId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const PurchaseOrderAbi = [
  {
    type: "function",
    name: "mintPurchaseOrder",
    inputs: [
      { name: "to", type: "address" },
      { name: "dealId", type: "uint256" },
      { name: "metadataURI", type: "string" },
      { name: "soulbound", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateStatus",
    inputs: [
      { name: "dealId", type: "uint256" },
      { name: "newStatus", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getPOByDeal",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "owner", type: "address" },
      { name: "status", type: "uint8" },
      { name: "metadataURI", type: "string" },
    ],
    stateMutability: "view",
  },
] as const;

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
