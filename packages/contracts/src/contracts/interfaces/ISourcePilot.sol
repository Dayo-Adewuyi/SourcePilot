// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISourcePilot - Shared interfaces for the SourcePilot protocol
/// @notice Defines common structs, events, and errors used across all contracts

// ═══════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════

enum DealStatus {
    None,           // 0 - Default / non-existent
    Locked,         // 1 - Funds locked in escrow
    Confirmed,      // 2 - Supplier confirmed order
    Shipped,        // 3 - Shipment in transit
    Delivered,      // 4 - Delivery confirmed
    Completed,      // 5 - Escrow released, deal done
    Disputed,       // 6 - Under dispute
    Refunded,       // 7 - Buyer refunded
    Cancelled       // 8 - Cancelled before shipment
}

enum DisputeStatus {
    None,
    Filed,
    SupplierResponded,
    Resolved,
    Expired
}

enum DisputeOutcome {
    None,
    BuyerWins,
    SupplierWins,
    Split
}

// ═══════════════════════════════════════════════════════════════
// STRUCTS
// ═══════════════════════════════════════════════════════════════

struct Deal {
    uint256 dealId;
    uint256 agentId;
    address buyer;
    address supplier;
    uint256 amount;            // USDC amount (6 decimals)
    uint256 platformFee;       // Calculated fee
    uint256 createdAt;
    uint256 deliveryDeadline;
    DealStatus status;
    string metadataURI;        // IPFS URI for full deal details
}

struct AgentConfig {
    uint256 agentId;
    address owner;
    string[] productCategories;
    uint256 minOrderSize;      // Minimum order in USDC (6 decimals)
    uint256 maxOrderSize;      // Maximum order in USDC (6 decimals)
    bool active;
    uint256 createdAt;
    uint256 totalDeals;
    uint256 totalVolume;       // Cumulative USDC volume
    uint256 successRate;       // Basis points (10000 = 100%)
}

struct PriceEntry {
    bytes32 productHash;       // keccak256 of normalized product identifier
    uint256 unitPrice;         // Price per unit in USDC (6 decimals)
    uint256 moq;               // Minimum order quantity
    uint256 shippingCost;      // Estimated shipping in USDC
    uint256 supplierScore;     // Composite score (0-10000 basis points)
    uint256 timestamp;
    string supplierRef;        // External supplier reference ID
}

struct Dispute {
    uint256 disputeId;
    uint256 dealId;
    address filedBy;
    string reason;
    uint256 filedAt;
    uint256 supplierDeadline;  // 7 days from filing
    DisputeStatus status;
    DisputeOutcome outcome;
    uint256 buyerRefundBps;    // Basis points of refund to buyer (0-10000)
}

// ═══════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════

interface IEscrowVault {
    event DealCreated(uint256 indexed dealId, uint256 indexed agentId, address indexed buyer, address supplier, uint256 amount);
    event DealConfirmed(uint256 indexed dealId);
    event DealShipped(uint256 indexed dealId);
    event DealDelivered(uint256 indexed dealId);
    event EscrowReleased(uint256 indexed dealId, address supplier, uint256 supplierAmount, uint256 feeAmount);
    event DealRefunded(uint256 indexed dealId, address buyer, uint256 amount);
    event DealCancelled(uint256 indexed dealId);
    event DealDisputed(uint256 indexed dealId);
    event ExpressSettlement(uint256 indexed dealId, uint256 premiumPaid);

    error DealNotFound(uint256 dealId);
    error InvalidDealStatus(uint256 dealId, DealStatus current, DealStatus expected);
    error InsufficientAllowance(uint256 required, uint256 actual);
    error ZeroAddress();
    error ZeroAmount();
    error DeadlineInPast();
    error OnlyBuyer(uint256 dealId);
    error OnlyWorkflow();
    error DealExpired(uint256 dealId);
}

interface IAgentRegistry {
    event AgentCreated(uint256 indexed agentId, address indexed owner);
    event AgentUpdated(uint256 indexed agentId);
    event AgentDeactivated(uint256 indexed agentId);
    event AgentReactivated(uint256 indexed agentId);
    event AgentStatsUpdated(uint256 indexed agentId, uint256 totalDeals, uint256 totalVolume, uint256 successRate);

    error AgentNotFound(uint256 agentId);
    error NotAgentOwner(uint256 agentId, address caller);
    error AgentInactive(uint256 agentId);
    error MaxAgentsReached(address owner, uint256 max);
    error InvalidOrderRange();
}

interface IPriceOracle {
    event PriceUpdated(bytes32 indexed productHash, uint256 unitPrice, uint256 supplierScore, uint256 timestamp);
    event PriceBatchUpdated(bytes32[] productHashes, uint256 timestamp);

    error StalePrice(bytes32 productHash, uint256 lastUpdate);
    error EmptyBatch();
}

interface IDisputeResolver {
    event DisputeFiled(uint256 indexed disputeId, uint256 indexed dealId, address indexed filedBy);
    event SupplierResponded(uint256 indexed disputeId, string response);
    event DisputeResolved(uint256 indexed disputeId, DisputeOutcome outcome, uint256 buyerRefundBps);
    event DisputeExpired(uint256 indexed disputeId);
    event DisputeFeeRefunded(uint256 indexed disputeId, address to);

    error DisputeNotFound(uint256 disputeId);
    error DisputeAlreadyExists(uint256 dealId);
    error NotDisputeParty(uint256 disputeId);
    error InvalidDisputeStatus(uint256 disputeId, DisputeStatus current);
    error SupplierDeadlineNotReached(uint256 disputeId);
    error InvalidRefundBps();
}

interface IPurchaseOrder {
    event PurchaseOrderMinted(uint256 indexed tokenId, uint256 indexed dealId, address indexed buyer);
    event PurchaseOrderStatusUpdated(uint256 indexed tokenId, DealStatus status);

    error OnlyEscrow();
    error TokenNotFound(uint256 tokenId);
}
