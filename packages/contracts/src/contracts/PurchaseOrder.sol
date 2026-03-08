// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ISourcePilot.sol";

/// @title PurchaseOrder - ERC-721 NFT representing procurement deals
/// @notice Each deal gets a PO NFT with full metadata (supplier, qty, price, terms, status)
/// @dev Minimal ERC-721 implementation (no OpenZeppelin dependency for gas optimization)
///
/// DESIGN:
/// - Only EscrowVault can mint POs (1:1 with deals)
/// - Status is synced from EscrowVault via authorized calls
/// - Token URI points to IPFS metadata containing full deal details
/// - Soulbound-optional: transfers can be disabled per-token for compliance

contract PurchaseOrder is IPurchaseOrder {

    // ═══════════════════════════════════════════════════════════
    // ERC-721 STORAGE
    // ═══════════════════════════════════════════════════════════

    string public name = "SourcePilot Purchase Order";
    string public symbol = "SPPO";

    mapping(uint256 => address) internal _owners;
    mapping(address => uint256) internal _balances;
    mapping(uint256 => address) internal _tokenApprovals;
    mapping(address => mapping(address => bool)) internal _operatorApprovals;

    // ═══════════════════════════════════════════════════════════
    // PO-SPECIFIC STORAGE
    // ═══════════════════════════════════════════════════════════

    address public admin;
    address public escrowVault;

    /// @notice tokenId -> dealId mapping
    mapping(uint256 => uint256) public tokenDealId;

    /// @notice tokenId -> current deal status
    mapping(uint256 => DealStatus) public tokenStatus;

    /// @notice tokenId -> metadata URI
    mapping(uint256 => string) internal _tokenURIs;

    /// @notice dealId -> tokenId mapping (reverse lookup)
    mapping(uint256 => uint256) public dealTokenId;

    /// @notice Whether transfers are locked (soulbound mode)
    mapping(uint256 => bool) public transferLocked;

    uint256 public totalSupply;

    // ═══════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════

    modifier onlyEscrow() {
        if (msg.sender != escrowVault) revert OnlyEscrow();
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "PurchaseOrder: not admin");
        _;
    }

    // ═══════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════

    constructor(address _admin, address _escrowVault) {
        require(_admin != address(0) && _escrowVault != address(0), "PurchaseOrder: zero address");
        admin = _admin;
        escrowVault = _escrowVault;
    }

    // ═══════════════════════════════════════════════════════════
    // PO MINTING & STATUS
    // ═══════════════════════════════════════════════════════════

    /// @notice Mint a Purchase Order NFT for a deal
    /// @dev Only callable by EscrowVault
    /// @param to The buyer (deal creator)
    /// @param dealId Associated deal ID
    /// @param metadataURI IPFS URI with deal details
    /// @param soulbound If true, token cannot be transferred
    /// @return tokenId The minted token ID
    function mintPurchaseOrder(
        address to,
        uint256 dealId,
        string calldata metadataURI,
        bool soulbound
    ) external onlyEscrow returns (uint256 tokenId) {
        require(to != address(0), "PurchaseOrder: mint to zero");
        require(dealTokenId[dealId] == 0, "PurchaseOrder: deal already has PO");

        tokenId = ++totalSupply;

        _owners[tokenId] = to;
        _balances[to] += 1;

        tokenDealId[tokenId] = dealId;
        dealTokenId[dealId] = tokenId;
        tokenStatus[tokenId] = DealStatus.Locked;
        _tokenURIs[tokenId] = metadataURI;
        transferLocked[tokenId] = soulbound;

        emit Transfer(address(0), to, tokenId);
        emit PurchaseOrderMinted(tokenId, dealId, to);
    }

    /// @notice Update the deal status on the PO NFT
    /// @dev Only callable by EscrowVault when deal status changes
    /// @param dealId The deal whose status changed
    /// @param newStatus New status to record
    function updateStatus(uint256 dealId, DealStatus newStatus) external onlyEscrow {
        uint256 tokenId = dealTokenId[dealId];
        if (tokenId == 0) revert TokenNotFound(tokenId);

        tokenStatus[tokenId] = newStatus;
        emit PurchaseOrderStatusUpdated(tokenId, newStatus);
    }

    // ═══════════════════════════════════════════════════════════
    // ERC-721 CORE
    // ═══════════════════════════════════════════════════════════

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function balanceOf(address owner) external view returns (uint256) {
        require(owner != address(0), "PurchaseOrder: zero address");
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "PurchaseOrder: nonexistent token");
        return owner;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "PurchaseOrder: nonexistent token");
        return _tokenURIs[tokenId];
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        require(msg.sender == owner || _operatorApprovals[owner][msg.sender], "PurchaseOrder: not authorized");
        _tokenApprovals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        require(_owners[tokenId] != address(0), "PurchaseOrder: nonexistent token");
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "PurchaseOrder: self approval");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(!transferLocked[tokenId], "PurchaseOrder: soulbound token");
        require(_isApprovedOrOwner(msg.sender, tokenId), "PurchaseOrder: not authorized");
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        require(_checkOnERC721Received(from, to, tokenId, data), "PurchaseOrder: non-receiver");
    }

    // ═══════════════════════════════════════════════════════════
    // VIEW HELPERS
    // ═══════════════════════════════════════════════════════════

    /// @notice Get full PO details by deal ID
    function getPOByDeal(uint256 dealId) external view returns (
        uint256 tokenId,
        address owner,
        DealStatus status,
        string memory metadataURI
    ) {
        tokenId = dealTokenId[dealId];
        if (tokenId == 0) revert TokenNotFound(0);
        owner = _owners[tokenId];
        status = tokenStatus[tokenId];
        metadataURI = _tokenURIs[tokenId];
    }

    /// @notice ERC-165 interface support
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x80ac58cd || // ERC721
            interfaceId == 0x01ffc9a7;   // ERC165
    }

    // ═══════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════

    function setEscrowVault(address _vault) external onlyAdmin {
        require(_vault != address(0), "PurchaseOrder: zero address");
        escrowVault = _vault;
    }

    /// @notice Toggle soulbound status for a token (admin override for disputes)
    function setTransferLock(uint256 tokenId, bool locked) external onlyAdmin {
        require(_owners[tokenId] != address(0), "PurchaseOrder: nonexistent token");
        transferLocked[tokenId] = locked;
    }

    // ═══════════════════════════════════════════════════════════
    // INTERNAL
    // ═══════════════════════════════════════════════════════════

    function _transfer(address from, address to, uint256 tokenId) internal {
        require(ownerOf(tokenId) == from, "PurchaseOrder: wrong owner");
        require(to != address(0), "PurchaseOrder: transfer to zero");

        delete _tokenApprovals[tokenId];
        _balances[from] -= 1;
        _balances[to] += 1;
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address owner = ownerOf(tokenId);
        return (spender == owner || getApproved(tokenId) == spender || isApprovedForAll(owner, spender));
    }

    function _checkOnERC721Received(address from, address to, uint256 tokenId, bytes memory data) internal returns (bool) {
        if (to.code.length == 0) return true;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 retval) {
            return retval == IERC721Receiver.onERC721Received.selector;
        } catch {
            return false;
        }
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}
