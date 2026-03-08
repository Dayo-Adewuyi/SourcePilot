// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ISourcePilot.sol";

/// @title EscrowVault - Trustless escrow for SourcePilot procurement deals
/// @notice Holds USDC deposits, locks funds per deal, releases on delivery or dispute resolution
/// @dev Designed for CRE workflow integration — only authorized workflow addresses can update deal status
///
/// SECURITY NOTES:
/// - Uses SafeERC20 pattern (manual) for USDC transfers
/// - Reentrancy protection via status checks (CEI pattern) + reentrancy guard
/// - All state changes happen BEFORE external calls
/// - Fee calculations use basis points to avoid floating point
/// - Express settlement has a separate premium to prevent gaming

contract EscrowVault is IEscrowVault {

    // ═══════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════

    uint256 public constant PLATFORM_FEE_BPS = 250;        // 2.5%
    uint256 public constant EXPRESS_PREMIUM_BPS = 50;       // 0.5%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_DEAL_DURATION = 180 days;
    uint256 public constant MIN_DEAL_AMOUNT = 50e6;         // $50 USDC (6 decimals)

    // ═══════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════

    address public immutable usdc;
    address public admin;
    address public pendingAdmin;
    address public feeCollector;
    address public purchaseOrderContract;
    address public disputeResolver;

    /// @notice Authorized CRE workflow addresses that can update deal status
    mapping(address => bool) public authorizedWorkflows;

    /// @notice Deal storage
    mapping(uint256 => Deal) public deals;
    uint256 public nextDealId;

    /// @notice Total fees collected (available for withdrawal)
    uint256 public accumulatedFees;

    /// @notice Reentrancy lock
    uint8 private _locked;

    // ═══════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════

    modifier onlyAdmin() {
        require(msg.sender == admin, "EscrowVault: not admin");
        _;
    }

    modifier onlyWorkflow() {
        if (!authorizedWorkflows[msg.sender]) revert OnlyWorkflow();
        _;
    }

    modifier onlyDisputeResolver() {
        require(msg.sender == disputeResolver, "EscrowVault: not dispute resolver");
        _;
    }

    modifier nonReentrant() {
        require(_locked != 1, "EscrowVault: reentrant call");
        _locked = 1;
        _;
        _locked = 0;
    }

    modifier validDeal(uint256 dealId) {
        if (deals[dealId].buyer == address(0)) revert DealNotFound(dealId);
        _;
    }

    // ═══════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════

    /// @param _usdc USDC token address on Base
    /// @param _admin Protocol admin address
    /// @param _feeCollector Address receiving platform fees
    constructor(address _usdc, address _admin, address _feeCollector) {
        if (_usdc == address(0)) revert ZeroAddress();
        if (_admin == address(0)) revert ZeroAddress();
        if (_feeCollector == address(0)) revert ZeroAddress();

        usdc = _usdc;
        admin = _admin;
        feeCollector = _feeCollector;
        nextDealId = 1;
    }

    // ═══════════════════════════════════════════════════════════
    // DEAL LIFECYCLE
    // ═══════════════════════════════════════════════════════════

    /// @notice Create a new deal and lock USDC in escrow
    /// @dev Buyer must have approved this contract for `amount` USDC beforehand
    /// @param agentId The agent that found this deal
    /// @param supplier Supplier wallet address for payment release
    /// @param amount USDC amount to lock (6 decimals)
    /// @param deliveryDeadline Unix timestamp for expected delivery
    /// @param metadataURI IPFS URI containing full deal details
    /// @return dealId The created deal ID
    function createDeal(
        uint256 agentId,
        address supplier,
        uint256 amount,
        uint256 deliveryDeadline,
        string calldata metadataURI
    ) external nonReentrant returns (uint256 dealId) {
        if (supplier == address(0)) revert ZeroAddress();
        if (amount < MIN_DEAL_AMOUNT) revert ZeroAmount();
        if (deliveryDeadline <= block.timestamp) revert DeadlineInPast();
        if (deliveryDeadline > block.timestamp + MAX_DEAL_DURATION) revert DeadlineInPast();

        // Calculate fee upfront
        uint256 fee = (amount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;

        dealId = nextDealId++;

        deals[dealId] = Deal({
            dealId: dealId,
            agentId: agentId,
            buyer: msg.sender,
            supplier: supplier,
            amount: amount,
            platformFee: fee,
            createdAt: block.timestamp,
            deliveryDeadline: deliveryDeadline,
            status: DealStatus.Locked,
            metadataURI: metadataURI
        });

        // Transfer USDC from buyer to this contract
        _safeTransferFrom(usdc, msg.sender, address(this), amount);

        emit DealCreated(dealId, agentId, msg.sender, supplier, amount);
    }

    /// @notice CRE workflow confirms supplier has acknowledged the order
    /// @param dealId The deal to confirm
    function confirmDeal(uint256 dealId) external onlyWorkflow validDeal(dealId) {
        Deal storage deal = deals[dealId];
        if (deal.status != DealStatus.Locked)
            revert InvalidDealStatus(dealId, deal.status, DealStatus.Locked);

        deal.status = DealStatus.Confirmed;
        emit DealConfirmed(dealId);
    }

    /// @notice CRE workflow marks deal as shipped
    /// @param dealId The deal to mark shipped
    function markShipped(uint256 dealId) external onlyWorkflow validDeal(dealId) {
        Deal storage deal = deals[dealId];
        if (deal.status != DealStatus.Confirmed)
            revert InvalidDealStatus(dealId, deal.status, DealStatus.Confirmed);

        deal.status = DealStatus.Shipped;
        emit DealShipped(dealId);
    }

    /// @notice CRE workflow confirms delivery and triggers escrow release
    /// @param dealId The deal with confirmed delivery
    function confirmDelivery(uint256 dealId) external onlyWorkflow nonReentrant validDeal(dealId) {
        Deal storage deal = deals[dealId];
        if (deal.status != DealStatus.Shipped)
            revert InvalidDealStatus(dealId, deal.status, DealStatus.Shipped);

        deal.status = DealStatus.Completed;

        _releaseEscrow(deal);

        emit DealDelivered(dealId);
    }

    /// @notice Buyer can request express settlement (before delivery confirmation)
    /// @dev Pays an additional 0.5% premium for instant release
    /// @param dealId The deal to settle early
    function expressSettle(uint256 dealId) external nonReentrant validDeal(dealId) {
        Deal storage deal = deals[dealId];
        if (msg.sender != deal.buyer) revert OnlyBuyer(dealId);
        if (deal.status != DealStatus.Shipped)
            revert InvalidDealStatus(dealId, deal.status, DealStatus.Shipped);

        uint256 expressPremium = (deal.amount * EXPRESS_PREMIUM_BPS) / BPS_DENOMINATOR;

        deal.status = DealStatus.Completed;
        deal.platformFee += expressPremium;

        _releaseEscrow(deal);

        emit ExpressSettlement(dealId, expressPremium);
    }

    /// @notice Buyer can cancel a deal that hasn't been confirmed by supplier yet
    /// @param dealId The deal to cancel
    function cancelDeal(uint256 dealId) external nonReentrant validDeal(dealId) {
        Deal storage deal = deals[dealId];
        if (msg.sender != deal.buyer) revert OnlyBuyer(dealId);
        if (deal.status != DealStatus.Locked)
            revert InvalidDealStatus(dealId, deal.status, DealStatus.Locked);

        deal.status = DealStatus.Cancelled;

        // Full refund to buyer
        _safeTransfer(usdc, deal.buyer, deal.amount);

        emit DealCancelled(dealId);
    }

    /// @notice Mark a deal as disputed (called by DisputeResolver)
    /// @param dealId The deal under dispute
    function markDisputed(uint256 dealId) external onlyDisputeResolver validDeal(dealId) {
        Deal storage deal = deals[dealId];
        // Can dispute if Confirmed, Shipped, or past deadline while Locked
        require(
            deal.status == DealStatus.Confirmed ||
            deal.status == DealStatus.Shipped ||
            (deal.status == DealStatus.Locked && block.timestamp > deal.deliveryDeadline),
            "EscrowVault: invalid status for dispute"
        );

        deal.status = DealStatus.Disputed;
        emit DealDisputed(dealId);
    }

    /// @notice Resolve a dispute by distributing funds according to outcome
    /// @param dealId The disputed deal
    /// @param buyerRefundBps Percentage (in bps) to refund to buyer. Remainder goes to supplier.
    function resolveDispute(
        uint256 dealId,
        uint256 buyerRefundBps
    ) external onlyDisputeResolver nonReentrant validDeal(dealId) {
        Deal storage deal = deals[dealId];
        if (deal.status != DealStatus.Disputed)
            revert InvalidDealStatus(dealId, deal.status, DealStatus.Disputed);
        require(buyerRefundBps <= BPS_DENOMINATOR, "EscrowVault: invalid bps");

        uint256 totalAmount = deal.amount;
        uint256 fee = deal.platformFee;
        uint256 distributable = totalAmount - fee;

        uint256 buyerRefund = (distributable * buyerRefundBps) / BPS_DENOMINATOR;
        uint256 supplierPayment = distributable - buyerRefund;

        // Mark as resolved based on outcome
        if (buyerRefundBps == BPS_DENOMINATOR) {
            deal.status = DealStatus.Refunded;
        } else {
            deal.status = DealStatus.Completed;
        }

        // Collect fee
        accumulatedFees += fee;

        // Distribute funds (CEI: state already updated above)
        if (buyerRefund > 0) {
            _safeTransfer(usdc, deal.buyer, buyerRefund);
        }
        if (supplierPayment > 0) {
            _safeTransfer(usdc, deal.supplier, supplierPayment);
        }
    }

    /// @notice Auto-refund buyer if delivery deadline has passed and deal is stale
    /// @dev Can be called by anyone (permissionless) as a safety mechanism
    /// @param dealId The expired deal
    function claimExpiredDeal(uint256 dealId) external nonReentrant validDeal(dealId) {
        Deal storage deal = deals[dealId];
        require(
            deal.status == DealStatus.Locked || deal.status == DealStatus.Confirmed,
            "EscrowVault: not claimable"
        );
        if (block.timestamp <= deal.deliveryDeadline) revert DealExpired(dealId);

        deal.status = DealStatus.Refunded;

        _safeTransfer(usdc, deal.buyer, deal.amount);

        emit DealRefunded(dealId, deal.buyer, deal.amount);
    }

    // ═══════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════

    /// @notice Initiate admin transfer (2-step for safety)
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin = newAdmin;
    }

    /// @notice Accept admin transfer
    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "EscrowVault: not pending admin");
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }

    function setFeeCollector(address _feeCollector) external onlyAdmin {
        if (_feeCollector == address(0)) revert ZeroAddress();
        feeCollector = _feeCollector;
    }

    function setAuthorizedWorkflow(address workflow, bool authorized) external onlyAdmin {
        if (workflow == address(0)) revert ZeroAddress();
        authorizedWorkflows[workflow] = authorized;
    }

    function setPurchaseOrderContract(address _po) external onlyAdmin {
        if (_po == address(0)) revert ZeroAddress();
        purchaseOrderContract = _po;
    }

    function setDisputeResolver(address _resolver) external onlyAdmin {
        if (_resolver == address(0)) revert ZeroAddress();
        disputeResolver = _resolver;
    }

    /// @notice Withdraw accumulated platform fees
    function withdrawFees() external nonReentrant onlyAdmin {
        uint256 amount = accumulatedFees;
        require(amount > 0, "EscrowVault: no fees");

        accumulatedFees = 0;
        _safeTransfer(usdc, feeCollector, amount);
    }

    // ═══════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    function getDeal(uint256 dealId) external view returns (Deal memory) {
        if (deals[dealId].buyer == address(0)) revert DealNotFound(dealId);
        return deals[dealId];
    }

    function getDealStatus(uint256 dealId) external view returns (DealStatus) {
        return deals[dealId].status;
    }

    function calculateFee(uint256 amount) external pure returns (uint256) {
        return (amount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
    }

    // ═══════════════════════════════════════════════════════════
    // INTERNAL
    // ═══════════════════════════════════════════════════════════

    /// @dev Release escrow: pay supplier and collect fee
    function _releaseEscrow(Deal storage deal) internal {
        uint256 fee = deal.platformFee;
        uint256 supplierAmount = deal.amount - fee;

        accumulatedFees += fee;

        _safeTransfer(usdc, deal.supplier, supplierAmount);

        emit EscrowReleased(deal.dealId, deal.supplier, supplierAmount, fee);
    }

    /// @dev Safe ERC20 transfer (handles non-standard return)
    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount) // transfer(address,uint256)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "EscrowVault: transfer failed");
    }

    /// @dev Safe ERC20 transferFrom (handles non-standard return)
    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0x23b872dd, from, to, amount) // transferFrom(address,address,uint256)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "EscrowVault: transferFrom failed");
    }
}
