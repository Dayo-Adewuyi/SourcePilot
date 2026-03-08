// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ISourcePilot.sol";

/// @title DisputeResolver - Handles procurement deal disputes with time-locked resolution
/// @notice Manages dispute lifecycle: filing, supplier response, resolution, and auto-expiry
/// @dev Integrates with EscrowVault for fund distribution after resolution
///
/// DISPUTE FLOW:
/// 1. Buyer files dispute (pays $5 USDC filing fee)
/// 2. Supplier has 7 days to respond
/// 3a. If supplier responds → admin resolves with split decision
/// 3b. If supplier doesn't respond → dispute expires → auto-refund to buyer
/// 4. Filing fee refunded to winning party

contract DisputeResolver is IDisputeResolver {

    // ═══════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════

    uint256 public constant DISPUTE_FEE = 5e6;                 // $5 USDC
    uint256 public constant SUPPLIER_RESPONSE_PERIOD = 7 days;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ═══════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════

    address public immutable usdc;
    address public admin;
    address public pendingAdmin;
    address public escrowVault;

    /// @notice Authorized arbitrators who can resolve disputes
    mapping(address => bool) public arbitrators;

    /// @notice Dispute storage
    mapping(uint256 => Dispute) public disputes;

    /// @notice dealId -> disputeId mapping (one dispute per deal)
    mapping(uint256 => uint256) public dealDisputeId;

    /// @notice Supplier response text
    mapping(uint256 => string) public supplierResponses;

    /// @notice Dispute fee deposits (disputeId -> depositor)
    mapping(uint256 => address) public feeDepositor;

    uint256 public nextDisputeId;

    /// @notice Reentrancy lock
    uint8 private _locked;

    // ═══════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════

    modifier onlyAdmin() {
        require(msg.sender == admin, "DisputeResolver: not admin");
        _;
    }

    modifier onlyArbitrator() {
        require(arbitrators[msg.sender] || msg.sender == admin, "DisputeResolver: not arbitrator");
        _;
    }

    modifier nonReentrant() {
        require(_locked != 1, "DisputeResolver: reentrant");
        _locked = 1;
        _;
        _locked = 0;
    }

    modifier validDispute(uint256 disputeId) {
        if (disputes[disputeId].filedBy == address(0)) revert DisputeNotFound(disputeId);
        _;
    }

    // ═══════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════

    constructor(address _usdc, address _admin, address _escrowVault) {
        require(_usdc != address(0) && _admin != address(0) && _escrowVault != address(0),
            "DisputeResolver: zero address");

        usdc = _usdc;
        admin = _admin;
        escrowVault = _escrowVault;
        nextDisputeId = 1;
    }

    // ═══════════════════════════════════════════════════════════
    // DISPUTE LIFECYCLE
    // ═══════════════════════════════════════════════════════════

    /// @notice File a dispute for a deal
    /// @dev Buyer must approve DISPUTE_FEE USDC before calling
    /// @param dealId The deal to dispute
    /// @param reason Description of the dispute
    /// @return disputeId The created dispute ID
    function fileDispute(
        uint256 dealId,
        string calldata reason
    ) external nonReentrant returns (uint256 disputeId) {
        // Check no existing dispute
        if (dealDisputeId[dealId] != 0) revert DisputeAlreadyExists(dealId);

        // Verify caller is the buyer of the deal
        (bool success, bytes memory data) = escrowVault.staticcall(
            abi.encodeWithSignature("getDeal(uint256)", dealId)
        );
        require(success, "DisputeResolver: getDeal failed");
        Deal memory deal = abi.decode(data, (Deal));
        require(deal.buyer == msg.sender, "DisputeResolver: not buyer");

        disputeId = nextDisputeId++;

        disputes[disputeId] = Dispute({
            disputeId: disputeId,
            dealId: dealId,
            filedBy: msg.sender,
            reason: reason,
            filedAt: block.timestamp,
            supplierDeadline: block.timestamp + SUPPLIER_RESPONSE_PERIOD,
            status: DisputeStatus.Filed,
            outcome: DisputeOutcome.None,
            buyerRefundBps: 0
        });

        dealDisputeId[dealId] = disputeId;
        feeDepositor[disputeId] = msg.sender;

        // Collect filing fee
        _safeTransferFrom(usdc, msg.sender, address(this), DISPUTE_FEE);

        // Mark deal as disputed in escrow
        (bool markSuccess,) = escrowVault.call(
            abi.encodeWithSignature("markDisputed(uint256)", dealId)
        );
        require(markSuccess, "DisputeResolver: markDisputed failed");

        emit DisputeFiled(disputeId, dealId, msg.sender);
    }

    /// @notice Supplier responds to a dispute
    /// @param disputeId The dispute to respond to
    /// @param response Supplier's response text
    function supplierRespond(
        uint256 disputeId,
        string calldata response
    ) external validDispute(disputeId) {
        Dispute storage dispute = disputes[disputeId];

        if (dispute.status != DisputeStatus.Filed)
            revert InvalidDisputeStatus(disputeId, dispute.status);

        // Verify caller is the supplier
        (bool success, bytes memory data) = escrowVault.staticcall(
            abi.encodeWithSignature("getDeal(uint256)", dispute.dealId)
        );
        require(success, "DisputeResolver: getDeal failed");
        Deal memory deal = abi.decode(data, (Deal));
        require(deal.supplier == msg.sender, "DisputeResolver: not supplier");

        dispute.status = DisputeStatus.SupplierResponded;
        supplierResponses[disputeId] = response;

        emit SupplierResponded(disputeId, response);
    }

    /// @notice Arbitrator resolves a dispute with a split decision
    /// @param disputeId The dispute to resolve
    /// @param buyerRefundBps Percentage of (amount - fee) to refund buyer (0-10000)
    function resolveDispute(
        uint256 disputeId,
        uint256 buyerRefundBps
    ) external onlyArbitrator nonReentrant validDispute(disputeId) {
        Dispute storage dispute = disputes[disputeId];

        require(
            dispute.status == DisputeStatus.Filed ||
            dispute.status == DisputeStatus.SupplierResponded,
            "DisputeResolver: not resolvable"
        );
        if (buyerRefundBps > BPS_DENOMINATOR) revert InvalidRefundBps();

        dispute.status = DisputeStatus.Resolved;
        dispute.buyerRefundBps = buyerRefundBps;

        // Determine outcome
        if (buyerRefundBps == BPS_DENOMINATOR) {
            dispute.outcome = DisputeOutcome.BuyerWins;
        } else if (buyerRefundBps == 0) {
            dispute.outcome = DisputeOutcome.SupplierWins;
        } else {
            dispute.outcome = DisputeOutcome.Split;
        }

        // Resolve in escrow (distributes funds)
        (bool resolveSuccess,) = escrowVault.call(
            abi.encodeWithSignature("resolveDispute(uint256,uint256)", dispute.dealId, buyerRefundBps)
        );
        require(resolveSuccess, "DisputeResolver: resolveDispute failed");

        // Refund filing fee to winner
        _refundDisputeFee(disputeId, dispute.outcome);

        emit DisputeResolved(disputeId, dispute.outcome, buyerRefundBps);
    }

    /// @notice Expire a dispute if supplier hasn't responded in time
    /// @dev Permissionless — anyone can call after supplier deadline
    /// @param disputeId The expired dispute
    function expireDispute(uint256 disputeId) external nonReentrant validDispute(disputeId) {
        Dispute storage dispute = disputes[disputeId];

        if (dispute.status != DisputeStatus.Filed)
            revert InvalidDisputeStatus(disputeId, dispute.status);
        if (block.timestamp <= dispute.supplierDeadline)
            revert SupplierDeadlineNotReached(disputeId);

        dispute.status = DisputeStatus.Expired;
        dispute.outcome = DisputeOutcome.BuyerWins;
        dispute.buyerRefundBps = BPS_DENOMINATOR; // Full refund

        // Auto-refund buyer via escrow
        (bool resolveSuccess,) = escrowVault.call(
            abi.encodeWithSignature("resolveDispute(uint256,uint256)", dispute.dealId, BPS_DENOMINATOR)
        );
        require(resolveSuccess, "DisputeResolver: resolve failed");

        // Refund dispute fee to buyer
        _safeTransfer(usdc, dispute.filedBy, DISPUTE_FEE);

        emit DisputeExpired(disputeId);
        emit DisputeFeeRefunded(disputeId, dispute.filedBy);
    }

    // ═══════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    function getDispute(uint256 disputeId) external view returns (Dispute memory) {
        if (disputes[disputeId].filedBy == address(0)) revert DisputeNotFound(disputeId);
        return disputes[disputeId];
    }

    function getDisputeByDeal(uint256 dealId) external view returns (Dispute memory) {
        uint256 disputeId = dealDisputeId[dealId];
        require(disputeId != 0, "DisputeResolver: no dispute for deal");
        return disputes[disputeId];
    }

    function getSupplierResponse(uint256 disputeId) external view returns (string memory) {
        return supplierResponses[disputeId];
    }

    function isDisputeExpirable(uint256 disputeId) external view returns (bool) {
        Dispute storage dispute = disputes[disputeId];
        return dispute.status == DisputeStatus.Filed &&
               block.timestamp > dispute.supplierDeadline;
    }

    // ═══════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "DisputeResolver: zero address");
        pendingAdmin = newAdmin;
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "DisputeResolver: not pending");
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }

    function setArbitrator(address arb, bool authorized) external onlyAdmin {
        require(arb != address(0), "DisputeResolver: zero address");
        arbitrators[arb] = authorized;
    }

    function setEscrowVault(address _vault) external onlyAdmin {
        require(_vault != address(0), "DisputeResolver: zero address");
        escrowVault = _vault;
    }

    // ═══════════════════════════════════════════════════════════
    // INTERNAL
    // ═══════════════════════════════════════════════════════════

    function _refundDisputeFee(uint256 disputeId, DisputeOutcome outcome) internal {
        address refundTo;

        if (outcome == DisputeOutcome.BuyerWins) {
            refundTo = disputes[disputeId].filedBy;
        } else if (outcome == DisputeOutcome.SupplierWins) {
            // Get supplier address from deal
            (bool success, bytes memory data) = escrowVault.staticcall(
                abi.encodeWithSignature("getDeal(uint256)", disputes[disputeId].dealId)
            );
            require(success, "DisputeResolver: getDeal failed");
            Deal memory deal = abi.decode(data, (Deal));
            refundTo = deal.supplier;
        } else {
            // Split — fee goes to protocol (no refund)
            return;
        }

        _safeTransfer(usdc, refundTo, DISPUTE_FEE);
        emit DisputeFeeRefunded(disputeId, refundTo);
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "DisputeResolver: transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0x23b872dd, from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "DisputeResolver: transferFrom failed");
    }
}
