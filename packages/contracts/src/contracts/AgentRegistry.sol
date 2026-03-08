// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ISourcePilot.sol";

/// @title AgentRegistry - Manages AI agent configurations and performance metrics
/// @notice Tracks agent ownership, product categories, order limits, and cumulative stats
/// @dev Stats are updated by authorized CRE workflows after deal completion

contract AgentRegistry is IAgentRegistry {

    // ═══════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════

    uint256 public constant MAX_AGENTS_FREE = 3;
    uint256 public constant MAX_AGENTS_PRO = 6;
    uint256 public constant MAX_AGENTS_BUSINESS = 10;
    uint256 public constant MAX_CATEGORIES_PER_AGENT = 20;

    // ═══════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════

    address public admin;
    address public pendingAdmin;

    /// @notice Authorized addresses (CRE workflows + escrow) that can update agent stats
    mapping(address => bool) public authorizedUpdaters;

    /// @notice Agent storage
    mapping(uint256 => AgentConfig) internal _agents;

    /// @notice Agent product categories stored separately for gas efficiency
    mapping(uint256 => string[]) internal _agentCategories;

    /// @notice Owner -> agent IDs mapping
    mapping(address => uint256[]) public ownerAgents;

    /// @notice Per-address agent limit tier (0=free, 1=pro, 2=business, 3=enterprise)
    mapping(address => uint8) public userTier;

    uint256 public nextAgentId;

    // ═══════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════

    modifier onlyAdmin() {
        require(msg.sender == admin, "AgentRegistry: not admin");
        _;
    }

    modifier onlyUpdater() {
        require(authorizedUpdaters[msg.sender], "AgentRegistry: not authorized updater");
        _;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        if (_agents[agentId].owner == address(0)) revert AgentNotFound(agentId);
        if (_agents[agentId].owner != msg.sender) revert NotAgentOwner(agentId, msg.sender);
        _;
    }

    // ═══════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════

    constructor(address _admin) {
        require(_admin != address(0), "AgentRegistry: zero admin");
        admin = _admin;
        nextAgentId = 1;
    }

    // ═══════════════════════════════════════════════════════════
    // AGENT MANAGEMENT
    // ═══════════════════════════════════════════════════════════

    /// @notice Create a new AI sourcing agent
    /// @param categories Product categories the agent will source
    /// @param minOrderSize Minimum USDC order size (6 decimals)
    /// @param maxOrderSize Maximum USDC order size (6 decimals)
    /// @return agentId The created agent ID
    function createAgent(
        string[] calldata categories,
        uint256 minOrderSize,
        uint256 maxOrderSize
    ) external returns (uint256 agentId) {
        if (minOrderSize >= maxOrderSize) revert InvalidOrderRange();
        require(categories.length > 0 && categories.length <= MAX_CATEGORIES_PER_AGENT, "AgentRegistry: invalid categories");

        // Check agent limit based on tier
        uint256 maxAgents = _getMaxAgents(userTier[msg.sender]);
        if (ownerAgents[msg.sender].length >= maxAgents)
            revert MaxAgentsReached(msg.sender, maxAgents);

        agentId = nextAgentId++;

        _agents[agentId] = AgentConfig({
            agentId: agentId,
            owner: msg.sender,
            productCategories: new string[](0), // stored separately
            minOrderSize: minOrderSize,
            maxOrderSize: maxOrderSize,
            active: true,
            createdAt: block.timestamp,
            totalDeals: 0,
            totalVolume: 0,
            successRate: 0
        });

        // Store categories separately
        for (uint256 i = 0; i < categories.length; i++) {
            _agentCategories[agentId].push(categories[i]);
        }

        ownerAgents[msg.sender].push(agentId);

        emit AgentCreated(agentId, msg.sender);
    }

    /// @notice Update agent product categories
    /// @param agentId Agent to update
    /// @param categories New product categories
    function updateCategories(
        uint256 agentId,
        string[] calldata categories
    ) external onlyAgentOwner(agentId) {
        require(categories.length > 0 && categories.length <= MAX_CATEGORIES_PER_AGENT, "AgentRegistry: invalid categories");

        delete _agentCategories[agentId];
        for (uint256 i = 0; i < categories.length; i++) {
            _agentCategories[agentId].push(categories[i]);
        }

        emit AgentUpdated(agentId);
    }

    /// @notice Update agent order size limits
    /// @param agentId Agent to update
    /// @param minOrderSize New minimum
    /// @param maxOrderSize New maximum
    function updateOrderLimits(
        uint256 agentId,
        uint256 minOrderSize,
        uint256 maxOrderSize
    ) external onlyAgentOwner(agentId) {
        if (minOrderSize >= maxOrderSize) revert InvalidOrderRange();

        _agents[agentId].minOrderSize = minOrderSize;
        _agents[agentId].maxOrderSize = maxOrderSize;

        emit AgentUpdated(agentId);
    }

    /// @notice Deactivate an agent (pauses all workflows)
    function deactivateAgent(uint256 agentId) external onlyAgentOwner(agentId) {
        if (!_agents[agentId].active) revert AgentInactive(agentId);

        _agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    /// @notice Reactivate a deactivated agent
    function reactivateAgent(uint256 agentId) external onlyAgentOwner(agentId) {
        require(!_agents[agentId].active, "AgentRegistry: already active");

        _agents[agentId].active = true;
        emit AgentReactivated(agentId);
    }

    // ═══════════════════════════════════════════════════════════
    // STATS UPDATES (CRE / ESCROW ONLY)
    // ═══════════════════════════════════════════════════════════

    /// @notice Record a completed deal for an agent
    /// @param agentId The agent that executed the deal
    /// @param volume USDC volume of the deal
    /// @param success Whether the deal completed successfully (not disputed/refunded)
    function recordDealCompletion(
        uint256 agentId,
        uint256 volume,
        bool success
    ) external onlyUpdater {
        if (_agents[agentId].owner == address(0)) revert AgentNotFound(agentId);

        AgentConfig storage agent = _agents[agentId];
        agent.totalDeals += 1;
        agent.totalVolume += volume;

        // Recalculate success rate: running weighted average in bps
        if (success) {
            // successRate = ((oldRate * (totalDeals - 1)) + 10000) / totalDeals
            agent.successRate = ((agent.successRate * (agent.totalDeals - 1)) + 10_000) / agent.totalDeals;
        } else {
            agent.successRate = (agent.successRate * (agent.totalDeals - 1)) / agent.totalDeals;
        }

        emit AgentStatsUpdated(agentId, agent.totalDeals, agent.totalVolume, agent.successRate);
    }

    // ═══════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "AgentRegistry: zero address");
        pendingAdmin = newAdmin;
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "AgentRegistry: not pending admin");
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }

    function setAuthorizedUpdater(address updater, bool authorized) external onlyAdmin {
        require(updater != address(0), "AgentRegistry: zero address");
        authorizedUpdaters[updater] = authorized;
    }

    /// @notice Set user subscription tier (determines max agents)
    /// @param user Address to update
    /// @param tier 0=free, 1=pro, 2=business, 3=enterprise
    function setUserTier(address user, uint8 tier) external onlyAdmin {
        require(tier <= 3, "AgentRegistry: invalid tier");
        userTier[user] = tier;
    }

    /// @notice Batch set user tiers
    function batchSetUserTier(address[] calldata users, uint8[] calldata tiers) external onlyAdmin {
        require(users.length == tiers.length, "AgentRegistry: length mismatch");
        for (uint256 i = 0; i < users.length; i++) {
            require(tiers[i] <= 3, "AgentRegistry: invalid tier");
            userTier[users[i]] = tiers[i];
        }
    }

    // ═══════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    function getAgent(uint256 agentId) external view returns (
        AgentConfig memory config,
        string[] memory categories
    ) {
        if (_agents[agentId].owner == address(0)) revert AgentNotFound(agentId);
        config = _agents[agentId];
        categories = _agentCategories[agentId];
    }

    function getAgentsByOwner(address owner) external view returns (uint256[] memory) {
        return ownerAgents[owner];
    }

    function isAgentActive(uint256 agentId) external view returns (bool) {
        return _agents[agentId].active && _agents[agentId].owner != address(0);
    }

    function getAgentOwner(uint256 agentId) external view returns (address) {
        return _agents[agentId].owner;
    }

    function getAgentStats(uint256 agentId) external view returns (
        uint256 totalDeals,
        uint256 totalVolume,
        uint256 successRate
    ) {
        AgentConfig storage agent = _agents[agentId];
        return (agent.totalDeals, agent.totalVolume, agent.successRate);
    }

    // ═══════════════════════════════════════════════════════════
    // INTERNAL
    // ═══════════════════════════════════════════════════════════

    function _getMaxAgents(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return MAX_AGENTS_FREE;
        if (tier == 1) return MAX_AGENTS_PRO;
        if (tier == 2) return MAX_AGENTS_BUSINESS;
        return type(uint256).max; // Enterprise = unlimited
    }
}
