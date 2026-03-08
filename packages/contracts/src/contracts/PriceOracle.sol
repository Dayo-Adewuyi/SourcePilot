// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ISourcePilot.sol";

/// @title PriceOracle - On-chain price feed updated by CRE Price Scanner workflow
/// @notice Stores consensus-verified supplier pricing data per product category
/// @dev Updated by CRE workflows only. Multiple entries per product hash for comparison.
///
/// DESIGN RATIONALE:
/// - Product identification uses keccak256 hash of normalized product string
/// - Each product can have up to MAX_ENTRIES_PER_PRODUCT price entries (top deals)
/// - Entries include supplier score for quality-weighted comparisons
/// - Staleness threshold ensures consumers don't rely on outdated data

contract PriceOracle is IPriceOracle {

    // ═══════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════

    uint256 public constant MAX_ENTRIES_PER_PRODUCT = 10;
    uint256 public constant DEFAULT_STALENESS_THRESHOLD = 6 hours;

    // ═══════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════

    address public admin;
    address public pendingAdmin;

    /// @notice Authorized CRE workflow addresses that can push price updates
    mapping(address => bool) public authorizedUpdaters;

    /// @notice Product hash -> array of price entries (top deals)
    mapping(bytes32 => PriceEntry[]) internal _priceEntries;

    /// @notice Product hash -> last update timestamp
    mapping(bytes32 => uint256) public lastUpdated;

    /// @notice Configurable staleness threshold
    uint256 public stalenessThreshold;

    /// @notice All known product hashes (for enumeration)
    bytes32[] public knownProducts;
    mapping(bytes32 => bool) public productExists;

    // ═══════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════

    modifier onlyAdmin() {
        require(msg.sender == admin, "PriceOracle: not admin");
        _;
    }

    modifier onlyUpdater() {
        require(authorizedUpdaters[msg.sender], "PriceOracle: not authorized");
        _;
    }

    // ═══════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════

    constructor(address _admin) {
        require(_admin != address(0), "PriceOracle: zero admin");
        admin = _admin;
        stalenessThreshold = DEFAULT_STALENESS_THRESHOLD;
    }

    // ═══════════════════════════════════════════════════════════
    // PRICE UPDATES (CRE WORKFLOW ONLY)
    // ═══════════════════════════════════════════════════════════

    /// @notice Update price entries for a single product
    /// @dev Replaces all existing entries for the product hash
    /// @param productHash keccak256 of the normalized product identifier
    /// @param entries Array of price entries (top deals found by scanner)
    function updatePrice(
        bytes32 productHash,
        PriceEntry[] calldata entries
    ) external onlyUpdater {
        require(entries.length > 0 && entries.length <= MAX_ENTRIES_PER_PRODUCT, "PriceOracle: invalid entries count");

        // Track new products
        if (!productExists[productHash]) {
            knownProducts.push(productHash);
            productExists[productHash] = true;
        }

        // Clear existing entries
        delete _priceEntries[productHash];

        // Store new entries
        for (uint256 i = 0; i < entries.length; i++) {
            require(entries[i].productHash == productHash, "PriceOracle: hash mismatch");
            require(entries[i].unitPrice > 0, "PriceOracle: zero price");
            _priceEntries[productHash].push(entries[i]);
        }

        lastUpdated[productHash] = block.timestamp;

        emit PriceUpdated(
            productHash,
            entries[0].unitPrice,     // Best price (entries assumed sorted)
            entries[0].supplierScore,
            block.timestamp
        );
    }

    /// @notice Batch update prices for multiple products in one tx
    /// @dev Gas-efficient for CRE workflows that scan multiple categories
    /// @param productHashes Array of product hashes
    /// @param allEntries Flattened array of entries
    /// @param entryCounts Number of entries per product (must sum to allEntries.length)
    function batchUpdatePrices(
        bytes32[] calldata productHashes,
        PriceEntry[] calldata allEntries,
        uint256[] calldata entryCounts
    ) external onlyUpdater {
        if (productHashes.length == 0) revert EmptyBatch();
        require(productHashes.length == entryCounts.length, "PriceOracle: length mismatch");

        uint256 offset = 0;
        for (uint256 i = 0; i < productHashes.length; i++) {
            uint256 count = entryCounts[i];
            require(count > 0 && count <= MAX_ENTRIES_PER_PRODUCT, "PriceOracle: invalid count");
            require(offset + count <= allEntries.length, "PriceOracle: overflow");

            bytes32 hash = productHashes[i];

            if (!productExists[hash]) {
                knownProducts.push(hash);
                productExists[hash] = true;
            }

            delete _priceEntries[hash];

            for (uint256 j = 0; j < count; j++) {
                PriceEntry calldata entry = allEntries[offset + j];
                require(entry.productHash == hash, "PriceOracle: hash mismatch");
                require(entry.unitPrice > 0, "PriceOracle: zero price");
                _priceEntries[hash].push(entry);
            }

            lastUpdated[hash] = block.timestamp;
            offset += count;
        }

        require(offset == allEntries.length, "PriceOracle: count mismatch");
        emit PriceBatchUpdated(productHashes, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════
    // PRICE QUERIES
    // ═══════════════════════════════════════════════════════════

    /// @notice Get all price entries for a product
    /// @param productHash Product identifier hash
    /// @return entries Array of price entries
    /// @return timestamp Last update time
    function getPrice(bytes32 productHash) external view returns (
        PriceEntry[] memory entries,
        uint256 timestamp
    ) {
        return (_priceEntries[productHash], lastUpdated[productHash]);
    }

    /// @notice Get the best (cheapest) price for a product
    /// @param productHash Product identifier hash
    /// @return bestEntry The entry with lowest unit price
    function getBestPrice(bytes32 productHash) external view returns (PriceEntry memory bestEntry) {
        PriceEntry[] storage entries = _priceEntries[productHash];
        require(entries.length > 0, "PriceOracle: no entries");

        bestEntry = entries[0];
        for (uint256 i = 1; i < entries.length; i++) {
            if (entries[i].unitPrice < bestEntry.unitPrice) {
                bestEntry = entries[i];
            }
        }
    }

    /// @notice Get the highest-scored supplier for a product
    /// @param productHash Product identifier hash
    /// @return bestEntry The entry with highest supplier score
    function getBestSupplier(bytes32 productHash) external view returns (PriceEntry memory bestEntry) {
        PriceEntry[] storage entries = _priceEntries[productHash];
        require(entries.length > 0, "PriceOracle: no entries");

        bestEntry = entries[0];
        for (uint256 i = 1; i < entries.length; i++) {
            if (entries[i].supplierScore > bestEntry.supplierScore) {
                bestEntry = entries[i];
            }
        }
    }

    /// @notice Check if price data is fresh
    /// @param productHash Product identifier hash
    /// @return isFresh Whether the price was updated within staleness threshold
    function isPriceFresh(bytes32 productHash) external view returns (bool isFresh) {
        return (block.timestamp - lastUpdated[productHash]) <= stalenessThreshold;
    }

    /// @notice Get number of tracked products
    function getProductCount() external view returns (uint256) {
        return knownProducts.length;
    }

    /// @notice Get number of price entries for a product
    function getEntryCount(bytes32 productHash) external view returns (uint256) {
        return _priceEntries[productHash].length;
    }

    /// @notice Compute product hash from a product identifier string
    /// @dev Convenience function for off-chain callers
    function computeProductHash(string calldata productId) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(productId));
    }

    // ═══════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "PriceOracle: zero address");
        pendingAdmin = newAdmin;
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "PriceOracle: not pending admin");
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }

    function setAuthorizedUpdater(address updater, bool authorized) external onlyAdmin {
        require(updater != address(0), "PriceOracle: zero address");
        authorizedUpdaters[updater] = authorized;
    }

    function setStalenessThreshold(uint256 _threshold) external onlyAdmin {
        require(_threshold >= 1 hours && _threshold <= 7 days, "PriceOracle: invalid threshold");
        stalenessThreshold = _threshold;
    }
}
