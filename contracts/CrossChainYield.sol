// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@zetachain/protocol-contracts/contracts/zevm/SystemContract.sol";
import "@zetachain/protocol-contracts/contracts/zevm/interfaces/UniversalContract.sol";
import "@zetachain/protocol-contracts/contracts/zevm/interfaces/IZRC20.sol";
import "@zetachain/protocol-contracts/contracts/Revert.sol";
import "./interfaces/IYieldProtocol.sol";

/**
 * @title CrossChainYield
 * @notice Protocol orchestration hub for managing yield farming operations across multiple blockchains
 * @dev Handles protocol integrations, cross-chain messaging, and yield optimization for the Bitcoin Yield Vault
 */
contract CrossChainYield is UniversalContract, Revertable, Abortable {
    // System contract reference
    SystemContract public immutable systemContract;
    
    // Protocol configuration structure
    struct ProtocolConfig {
        address protocolAdapter;     // Protocol-specific adapter contract
        address tokenAddress;       // Token address on target chain
        uint256 chainId;            // Target blockchain ID
        uint256 currentAPY;         // Current APY in basis points
        uint256 tvl;                // Total Value Locked in this protocol
        uint256 lastAPYUpdate;      // Last APY update timestamp
        bool isActive;              // Whether protocol is active
        bool autoCompound;          // Whether to auto-compound yields
        uint256 minDeposit;         // Minimum deposit amount
        uint256 maxDeposit;         // Maximum deposit amount
        string protocolName;        // Human-readable protocol name
    }
    
    // User position tracking per protocol
    struct UserPosition {
        uint256 principal;          // Original deposit amount
        uint256 accruedYield;      // Accumulated yield
        uint256 lastHarvestTime;   // Last yield harvest timestamp
        uint256 lastUpdateTime;    // Last position update
        bool isActive;             // Whether position is active
    }
    
    // Cross-chain operation tracking
    struct CrossChainOperation {
        address user;
        uint256 protocolId;
        uint256 amount;
        OperationType opType;
        OperationStatus status;
        uint256 timestamp;
        uint256 targetChain;
        bytes callData;
        uint256 retryCount;
    }
    
    enum OperationType {
        Deposit,
        Withdraw,
        Harvest,
        Rebalance,
        Emergency
    }
    
    enum OperationStatus {
        Pending,
        InProgress,
        Completed,
        Failed,
        Reverted,
        Aborted
    }
    
    // State mappings
    mapping(uint256 => ProtocolConfig) public protocols;
    mapping(address => mapping(uint256 => UserPosition)) public userPositions; // user => protocolId => position
    mapping(bytes32 => CrossChainOperation) public crossChainOps;
    mapping(uint256 => address) public chainToZRC20;
    mapping(address => bool) public authorizedVaults;
    mapping(uint256 => uint256[]) public chainProtocols; // chainId => protocolIds[]
    
    // State variables
    uint256 public protocolCount;
    uint256 public totalTVL;
    uint256 public totalYieldHarvested;
    address public admin;
    address public emergencyAdmin;
    bool public paused;
    uint256 public defaultSlippage = 300; // 3% in basis points
    uint256 public maxRetries = 3;
    
    // Constants
    uint256 private constant BASIS_POINTS = 10_000;
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant MAX_PROTOCOLS_PER_CHAIN = 10;
    
    // Events
    event ProtocolAdded(uint256 indexed protocolId, address adapter, uint256 chainId, string name);
    event ProtocolUpdated(uint256 indexed protocolId, uint256 newAPY, bool isActive);
    event FundsDeployed(address indexed user, uint256 indexed protocolId, uint256 amount, uint256 timestamp);
    event FundsWithdrawn(address indexed user, uint256 indexed protocolId, uint256 amount, uint256 timestamp);
    event YieldHarvested(address indexed user, uint256 indexed protocolId, uint256 yieldAmount, uint256 timestamp);
    event YieldReinvested(address indexed user, uint256 indexed protocolId, uint256 amount, uint256 timestamp);
    event CrossChainOpInitiated(bytes32 indexed opId, address user, uint256 protocolId, OperationType opType);
    event CrossChainOpCompleted(bytes32 indexed opId, bool success, uint256 timestamp);
    event ProtocolRebalanced(uint256 fromProtocol, uint256 toProtocol, uint256 amount);
    event EmergencyWithdrawal(address indexed user, uint256 indexed protocolId, uint256 amount, string reason);
    event APYUpdated(uint256 indexed protocolId, uint256 oldAPY, uint256 newAPY, uint256 timestamp);
    
    // Modifiers
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin allowed");
        _;
    }
    
    modifier onlyEmergencyAdmin() {
        require(msg.sender == emergencyAdmin || msg.sender == admin, "Only emergency admin allowed");
        _;
    }
    
    modifier onlyAuthorizedVault() {
        require(authorizedVaults[msg.sender], "Only authorized vault allowed");
        _;
    }
    
    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }
    
    modifier validProtocol(uint256 protocolId) {
        require(protocolId > 0 && protocolId <= protocolCount, "Invalid protocol ID");
        require(protocols[protocolId].isActive, "Protocol is not active");
        _;
    }
    
    /**
     * @notice Constructor
     * @param _systemContract ZetaChain system contract
     * @param _emergencyAdmin Emergency admin address
     */
    constructor(address _systemContract, address _emergencyAdmin) {
        systemContract = SystemContract(_systemContract);
        admin = msg.sender;
        emergencyAdmin = _emergencyAdmin;
        paused = false;
    }
    
    // ==================== PROTOCOL MANAGEMENT ====================
    
    /**
     * @notice Add a new yield protocol
     * @param adapter Protocol adapter contract address
     * @param tokenAddress Token address on target chain
     * @param chainId Target blockchain ID
     * @param apy Initial APY in basis points
     * @param protocolName Human-readable protocol name
     * @param minDeposit Minimum deposit amount
     * @param maxDeposit Maximum deposit amount
     */
    function addProtocol(
        address adapter,
        address tokenAddress,
        uint256 chainId,
        uint256 apy,
        string memory protocolName,
        uint256 minDeposit,
        uint256 maxDeposit
    ) external onlyAdmin {
        require(adapter != address(0), "Invalid adapter address");
        require(chainToZRC20[chainId] != address(0), "Chain not supported");
        require(chainProtocols[chainId].length < MAX_PROTOCOLS_PER_CHAIN, "Too many protocols on chain");
        
        protocolCount++;
        
        protocols[protocolCount] = ProtocolConfig({
            protocolAdapter: adapter,
            tokenAddress: tokenAddress,
            chainId: chainId,
            currentAPY: apy,
            tvl: 0,
            lastAPYUpdate: block.timestamp,
            isActive: true,
            autoCompound: true,
            minDeposit: minDeposit,
            maxDeposit: maxDeposit,
            protocolName: protocolName
        });
        
        chainProtocols[chainId].push(protocolCount);
        
        emit ProtocolAdded(protocolCount, adapter, chainId, protocolName);
    }
    
    /**
     * @notice Update protocol configuration
     * @param protocolId Protocol ID to update
     * @param newAPY New APY in basis points
     * @param isActive Whether protocol should be active
     * @param autoCompound Whether to auto-compound yields
     */
    function updateProtocol(
        uint256 protocolId,
        uint256 newAPY,
        bool isActive,
        bool autoCompound
    ) external onlyAdmin validProtocol(protocolId) {
        ProtocolConfig storage protocol = protocols[protocolId];
        
        uint256 oldAPY = protocol.currentAPY;
        protocol.currentAPY = newAPY;
        protocol.isActive = isActive;
        protocol.autoCompound = autoCompound;
        protocol.lastAPYUpdate = block.timestamp;
        
        emit ProtocolUpdated(protocolId, newAPY, isActive);
        emit APYUpdated(protocolId, oldAPY, newAPY, block.timestamp);
    }
    
    // ==================== YIELD FARMING OPERATIONS ====================
    
    /**
     * @notice Deploy funds to a specific yield protocol
     * @param user User address
     * @param protocolId Target protocol ID
     * @param amount Amount to deploy
     */
    function deployToProtocol(
        address user,
        uint256 protocolId,
        uint256 amount
    ) external onlyAuthorizedVault whenNotPaused validProtocol(protocolId) {
        require(user != address(0), "Invalid user address");
        require(amount > 0, "Amount must be greater than 0");
        
        ProtocolConfig storage protocol = protocols[protocolId];
        require(amount >= protocol.minDeposit, "Amount below minimum deposit");
        require(amount <= protocol.maxDeposit, "Amount exceeds maximum deposit");
        
        // Update user's accrued yield before new deployment
        _updateUserYield(user, protocolId);
        
        UserPosition storage position = userPositions[user][protocolId];
        
        if (!position.isActive) {
            position.isActive = true;
            position.lastHarvestTime = block.timestamp;
            position.lastUpdateTime = block.timestamp;
        }
        
        position.principal += amount;
        protocol.tvl += amount;
        totalTVL += amount;
        
        emit FundsDeployed(user, protocolId, amount, block.timestamp);
        
        // Initiate cross-chain deployment
        _initiateCrossChainDeployment(user, protocolId, amount);
    }
    
    /**
     * @notice Withdraw funds from a yield protocol
     * @param user User address
     * @param protocolId Protocol ID to withdraw from
     * @param amount Amount to withdraw (0 for full withdrawal)
     */
    function withdrawFromProtocol(
        address user,
        uint256 protocolId,
        uint256 amount
    ) external onlyAuthorizedVault whenNotPaused validProtocol(protocolId) {
        UserPosition storage position = userPositions[user][protocolId];
        require(position.isActive, "No active position");
        
        // Update yield before withdrawal
        _updateUserYield(user, protocolId);
        
        uint256 totalAvailable = position.principal + position.accruedYield;
        uint256 withdrawAmount = amount == 0 ? totalAvailable : amount;
        
        require(withdrawAmount <= totalAvailable, "Insufficient balance");
        require(withdrawAmount > 0, "Withdrawal amount must be greater than 0");
        
        // Calculate proportional reduction
        if (withdrawAmount >= totalAvailable) {
            // Full withdrawal
            position.principal = 0;
            position.accruedYield = 0;
            position.isActive = false;
        } else {
            // Partial withdrawal
            uint256 remainingRatio = ((totalAvailable - withdrawAmount) * BASIS_POINTS) / totalAvailable;
            position.principal = (position.principal * remainingRatio) / BASIS_POINTS;
            position.accruedYield = (position.accruedYield * remainingRatio) / BASIS_POINTS;
        }
        
        // Update protocol TVL
        protocols[protocolId].tvl -= (withdrawAmount > protocols[protocolId].tvl ? protocols[protocolId].tvl : withdrawAmount);
        totalTVL -= (withdrawAmount > totalTVL ? totalTVL : withdrawAmount);
        
        emit FundsWithdrawn(user, protocolId, withdrawAmount, block.timestamp);
        
        // Initiate cross-chain withdrawal
        _initiateCrossChainWithdrawal(user, protocolId, withdrawAmount);
    }
    
    /**
     * @notice Harvest yield from a specific protocol
     * @param user User address
     * @param protocolId Protocol ID to harvest from
     */
    function harvestYield(
        address user,
        uint256 protocolId
    ) external onlyAuthorizedVault whenNotPaused validProtocol(protocolId) {
        UserPosition storage position = userPositions[user][protocolId];
        require(position.isActive, "No active position");
        
        // Update yield calculation
        _updateUserYield(user, protocolId);
        
        uint256 yieldAmount = position.accruedYield;
        require(yieldAmount > 0, "No yield to harvest");
        
        position.accruedYield = 0;
        position.lastHarvestTime = block.timestamp;
        totalYieldHarvested += yieldAmount;
        
        emit YieldHarvested(user, protocolId, yieldAmount, block.timestamp);
        
        // Auto-compound if enabled
        if (protocols[protocolId].autoCompound) {
            _reinvestYield(user, protocolId, yieldAmount);
        }
        
        // Initiate cross-chain harvest
        _initiateCrossChainHarvest(user, protocolId, yieldAmount);
    }
    
    /**
     * @notice Harvest yield from all user's active positions
     * @param user User address
     */
    function harvestAllYield(address user) external onlyAuthorizedVault whenNotPaused {
        for (uint256 i = 1; i <= protocolCount; i++) {
            UserPosition storage position = userPositions[user][i];
            if (position.isActive && protocols[i].isActive) {
                _updateUserYield(user, i);
                
                uint256 yieldAmount = position.accruedYield;
                if (yieldAmount > 0) {
                    position.accruedYield = 0;
                    position.lastHarvestTime = block.timestamp;
                    totalYieldHarvested += yieldAmount;
                    
                    emit YieldHarvested(user, i, yieldAmount, block.timestamp);
                    
                    if (protocols[i].autoCompound) {
                        _reinvestYield(user, i, yieldAmount);
                    }
                    
                    _initiateCrossChainHarvest(user, i, yieldAmount);
                }
            }
        }
    }
    
    // ==================== CROSS-CHAIN OPERATIONS ====================
    
    /**
     * @notice Initiate cross-chain deployment
     * @param user User address
     * @param protocolId Protocol ID
     * @param amount Amount to deploy
     */
    function _initiateCrossChainDeployment(
        address user,
        uint256 protocolId,
        uint256 amount
    ) internal {
        ProtocolConfig storage protocol = protocols[protocolId];
        
        bytes32 opId = keccak256(abi.encodePacked(
            user, protocolId, amount, block.timestamp, "deploy"
        ));
        
        bytes memory callData = abi.encodeWithSignature(
            "deposit(uint256)",
            amount
        );
        
        crossChainOps[opId] = CrossChainOperation({
            user: user,
            protocolId: protocolId,
            amount: amount,
            opType: OperationType.Deposit,
            status: OperationStatus.Pending,
            timestamp: block.timestamp,
            targetChain: protocol.chainId,
            callData: callData,
            retryCount: 0
        });
        
        emit CrossChainOpInitiated(opId, user, protocolId, OperationType.Deposit);
        
        // Execute cross-chain call
        _executeCrossChainCall(opId, protocol.chainId, protocol.protocolAdapter, callData);
    }
    
    /**
     * @notice Initiate cross-chain withdrawal
     * @param user User address
     * @param protocolId Protocol ID
     * @param amount Amount to withdraw
     */
    function _initiateCrossChainWithdrawal(
        address user,
        uint256 protocolId,
        uint256 amount
    ) internal {
        ProtocolConfig storage protocol = protocols[protocolId];
        
        bytes32 opId = keccak256(abi.encodePacked(
            user, protocolId, amount, block.timestamp, "withdraw"
        ));
        
        bytes memory callData = abi.encodeWithSignature(
            "withdraw(uint256)",
            amount
        );
        
        crossChainOps[opId] = CrossChainOperation({
            user: user,
            protocolId: protocolId,
            amount: amount,
            opType: OperationType.Withdraw,
            status: OperationStatus.Pending,
            timestamp: block.timestamp,
            targetChain: protocol.chainId,
            callData: callData,
            retryCount: 0
        });
        
        emit CrossChainOpInitiated(opId, user, protocolId, OperationType.Withdraw);
        
        // Execute cross-chain call
        _executeCrossChainCall(opId, protocol.chainId, protocol.protocolAdapter, callData);
    }
    
    /**
     * @notice Initiate cross-chain harvest
     * @param user User address
     * @param protocolId Protocol ID
     * @param yieldAmount Expected yield amount
     */
    function _initiateCrossChainHarvest(
        address user,
        uint256 protocolId,
        uint256 yieldAmount
    ) internal {
        ProtocolConfig storage protocol = protocols[protocolId];
        
        bytes32 opId = keccak256(abi.encodePacked(
            user, protocolId, yieldAmount, block.timestamp, "harvest"
        ));
        
        bytes memory callData = abi.encodeWithSignature("harvest()");
        
        crossChainOps[opId] = CrossChainOperation({
            user: user,
            protocolId: protocolId,
            amount: yieldAmount,
            opType: OperationType.Harvest,
            status: OperationStatus.Pending,
            timestamp: block.timestamp,
            targetChain: protocol.chainId,
            callData: callData,
            retryCount: 0
        });
        
        emit CrossChainOpInitiated(opId, user, protocolId, OperationType.Harvest);
        
        // Execute cross-chain call
        _executeCrossChainCall(opId, protocol.chainId, protocol.protocolAdapter, callData);
    }
    
    /**
     * @notice Execute cross-chain call
     * @param opId Operation ID
     * @param targetChain Target chain ID
     * @param targetContract Target contract address
     * @param callData Call data to execute
     */
    function _executeCrossChainCall(
        bytes32 opId,
        uint256 targetChain,
        address targetContract,
        bytes memory callData
    ) internal {
        address zrc20 = chainToZRC20[targetChain];
        require(zrc20 != address(0), "Unsupported target chain");
        
        // Update operation status
        crossChainOps[opId].status = OperationStatus.InProgress;
        
        // Prepare message with operation ID
        bytes memory message = abi.encode(opId, callData);
        
        // Execute through ZetaChain gateway
        try IZRC20(zrc20).withdraw(abi.encodePacked(targetContract), 0) {
            // Cross-chain call initiated successfully
        } catch {
            // Handle immediate failure
            crossChainOps[opId].status = OperationStatus.Failed;
            emit CrossChainOpCompleted(opId, false, block.timestamp);
        }
    }
    
    // ==================== UNIVERSAL CONTRACT INTERFACE ====================
    
    /**
     * @notice Handle successful cross-chain calls
     * @param context Message context
     * @param zrc20 ZRC20 token address
     * @param amount Token amount
     * @param message Encoded message data
     */
    function onCall(
        MessageContext calldata context,
        address zrc20,
        uint256 amount,
        bytes calldata message
    ) external override {
        (bytes32 opId, bytes memory callData) = abi.decode(message, (bytes32, bytes));
        
        CrossChainOperation storage operation = crossChainOps[opId];
        require(operation.status == OperationStatus.InProgress, "Operation not in progress");
        
        // Update operation status
        operation.status = OperationStatus.Completed;
        
        // Handle operation-specific success logic
        if (operation.opType == OperationType.Deposit) {
            _handleDepositSuccess(operation);
        } else if (operation.opType == OperationType.Withdraw) {
            _handleWithdrawSuccess(operation);
        } else if (operation.opType == OperationType.Harvest) {
            _handleHarvestSuccess(operation);
        }
        
        emit CrossChainOpCompleted(opId, true, block.timestamp);
    }
    
    /**
     * @notice Handle failed cross-chain calls
     * @param context Revert context containing sender, asset, amount, and message
     */
    function onRevert(
        RevertContext calldata context
    ) external override {
        (bytes32 opId, bytes memory callData) = abi.decode(context.revertMessage, (bytes32, bytes));
        
        CrossChainOperation storage operation = crossChainOps[opId];
        require(operation.status == OperationStatus.InProgress, "Operation not in progress");
        
        // Update operation status
        operation.status = OperationStatus.Reverted;
        operation.retryCount++;
        
        // Attempt retry or handle failure
        if (operation.retryCount < maxRetries) {
            _retryOperation(opId);
        } else {
            _handleOperationFailure(operation);
        }
        
        emit CrossChainOpCompleted(opId, false, block.timestamp);
    }
    
    /**
     * @notice Handle aborted cross-chain calls
     * @param context Abort context containing sender, asset, amount, and message
     */
    function onAbort(
        AbortContext calldata context
    ) external override {
        (bytes32 opId, bytes memory callData) = abi.decode(context.revertMessage, (bytes32, bytes));
        
        CrossChainOperation storage operation = crossChainOps[opId];
        require(operation.status == OperationStatus.InProgress, "Operation not in progress");
        
        // Update operation status
        operation.status = OperationStatus.Aborted;
        
        // Handle emergency recovery
        _handleOperationFailure(operation);
        
        emit CrossChainOpCompleted(opId, false, block.timestamp);
    }
    
    // ==================== INTERNAL HELPER FUNCTIONS ====================
    
    /**
     * @notice Update user's accrued yield for a specific protocol
     * @param user User address
     * @param protocolId Protocol ID
     */
    function _updateUserYield(address user, uint256 protocolId) internal {
        UserPosition storage position = userPositions[user][protocolId];
        ProtocolConfig storage protocol = protocols[protocolId];
        
        if (!position.isActive || position.principal == 0) {
            return;
        }
        
        uint256 timeElapsed = block.timestamp - position.lastUpdateTime;
        
        if (timeElapsed > 0 && protocol.currentAPY > 0) {
            uint256 yieldAccrued = (position.principal * protocol.currentAPY * timeElapsed) / 
                (BASIS_POINTS * SECONDS_PER_YEAR);
            
            position.accruedYield += yieldAccrued;
            position.lastUpdateTime = block.timestamp;
        }
    }
    
    /**
     * @notice Reinvest yield into the same protocol
     * @param user User address
     * @param protocolId Protocol ID
     * @param yieldAmount Yield amount to reinvest
     */
    function _reinvestYield(address user, uint256 protocolId, uint256 yieldAmount) internal {
        UserPosition storage position = userPositions[user][protocolId];
        ProtocolConfig storage protocol = protocols[protocolId];
        
        // Add yield to principal for compounding
        position.principal += yieldAmount;
        protocol.tvl += yieldAmount;
        totalTVL += yieldAmount;
        
        emit YieldReinvested(user, protocolId, yieldAmount, block.timestamp);
    }
    
    /**
     * @notice Handle successful deposit operation
     * @param operation Cross-chain operation
     */
    function _handleDepositSuccess(CrossChainOperation storage operation) internal {
        // Update protocol TVL and user position confirmation
        // Additional success-specific logic can be added here
    }
    
    /**
     * @notice Handle successful withdrawal operation
     * @param operation Cross-chain operation
     */
    function _handleWithdrawSuccess(CrossChainOperation storage operation) internal {
        // Confirm withdrawal completion
        // Additional success-specific logic can be added here
    }
    
    /**
     * @notice Handle successful harvest operation
     * @param operation Cross-chain operation
     */
    function _handleHarvestSuccess(CrossChainOperation storage operation) internal {
        // Confirm harvest completion
        // Additional success-specific logic can be added here
    }
    
    /**
     * @notice Retry failed operation
     * @param opId Operation ID
     */
    function _retryOperation(bytes32 opId) internal {
        CrossChainOperation storage operation = crossChainOps[opId];
        
        // Reset status for retry
        operation.status = OperationStatus.Pending;
        
        // Execute cross-chain call again
        ProtocolConfig storage protocol = protocols[operation.protocolId];
        _executeCrossChainCall(opId, protocol.chainId, protocol.protocolAdapter, operation.callData);
    }
    
    /**
     * @notice Handle operation failure
     * @param operation Cross-chain operation
     */
    function _handleOperationFailure(CrossChainOperation storage operation) internal {
        // Revert user position changes if deposit failed
        if (operation.opType == OperationType.Deposit) {
            UserPosition storage position = userPositions[operation.user][operation.protocolId];
            ProtocolConfig storage protocol = protocols[operation.protocolId];
            
            // Revert position changes
            if (position.principal >= operation.amount) {
                position.principal -= operation.amount;
                protocol.tvl -= operation.amount;
                totalTVL -= operation.amount;
            }
            
            emit EmergencyWithdrawal(operation.user, operation.protocolId, operation.amount, "Deposit failed");
        }
    }
    
    // ==================== PROTOCOL OPTIMIZATION ====================
    
    /**
     * @notice Get best protocol based on APY
     * @param chainId Optional chain ID filter
     * @return protocolId Best protocol ID
     */
    function getBestProtocol(uint256 chainId) external view returns (uint256 protocolId) {
        uint256 bestAPY = 0;
        uint256 bestProtocolId = 0;
        
        for (uint256 i = 1; i <= protocolCount; i++) {
            ProtocolConfig storage protocol = protocols[i];
            
            if (protocol.isActive && 
                (chainId == 0 || protocol.chainId == chainId) &&
                protocol.currentAPY > bestAPY) {
                bestAPY = protocol.currentAPY;
                bestProtocolId = i;
            }
        }
        
        return bestProtocolId;
    }
    
    /**
     * @notice Rebalance funds between protocols
     * @param user User address
     * @param fromProtocol Source protocol ID
     * @param toProtocol Target protocol ID
     * @param amount Amount to rebalance
     */
    function rebalanceProtocols(
        address user,
        uint256 fromProtocol,
        uint256 toProtocol,
        uint256 amount
    ) external onlyAuthorizedVault whenNotPaused {
        require(fromProtocol != toProtocol, "Cannot rebalance to same protocol");
        require(protocols[fromProtocol].isActive, "Source protocol not active");
        require(protocols[toProtocol].isActive, "Target protocol not active");
        
        UserPosition storage fromPosition = userPositions[user][fromProtocol];
        require(fromPosition.isActive, "No position in source protocol");
        require(fromPosition.principal >= amount, "Insufficient balance");
        
        // Update yields before rebalancing
        _updateUserYield(user, fromProtocol);
        _updateUserYield(user, toProtocol);
        
        // Move funds between positions
        fromPosition.principal -= amount;
        protocols[fromProtocol].tvl -= amount;
        
        UserPosition storage toPosition = userPositions[user][toProtocol];
        if (!toPosition.isActive) {
            toPosition.isActive = true;
            toPosition.lastHarvestTime = block.timestamp;
            toPosition.lastUpdateTime = block.timestamp;
        }
        
        toPosition.principal += amount;
        protocols[toProtocol].tvl += amount;
        
        emit ProtocolRebalanced(fromProtocol, toProtocol, amount);
        
        // Initiate cross-chain rebalancing
        _initiateCrossChainRebalance(user, fromProtocol, toProtocol, amount);
    }
    
    /**
     * @notice Initiate cross-chain rebalancing
     * @param user User address
     * @param fromProtocol Source protocol
     * @param toProtocol Target protocol
     * @param amount Amount to rebalance
     */
    function _initiateCrossChainRebalance(
        address user,
        uint256 fromProtocol,
        uint256 toProtocol,
        uint256 amount
    ) internal {
        // First withdraw from source protocol
        _initiateCrossChainWithdrawal(user, fromProtocol, amount);
        
        // Then deploy to target protocol (would be handled in onCall callback)
        // Implementation depends on specific cross-chain message handling
    }
    
    // ==================== ADMIN FUNCTIONS ====================
    
    /**
     * @notice Set chain ZRC20 mapping
     * @param chainId Chain ID
     * @param zrc20Address ZRC20 token address
     */
    function setChainZRC20(uint256 chainId, address zrc20Address) external onlyAdmin {
        chainToZRC20[chainId] = zrc20Address;
    }
    
    /**
     * @notice Authorize vault contract
     * @param vault Vault contract address
     * @param authorized Whether to authorize
     */
    function setAuthorizedVault(address vault, bool authorized) external onlyAdmin {
        authorizedVaults[vault] = authorized;
    }
    
    /**
     * @notice Set contract parameters
     * @param _defaultSlippage Default slippage tolerance
     * @param _maxRetries Maximum retry attempts
     */
    function setParameters(uint256 _defaultSlippage, uint256 _maxRetries) external onlyAdmin {
        require(_defaultSlippage <= 1000, "Slippage too high"); // Max 10%
        require(_maxRetries <= 5, "Too many retries");
        
        defaultSlippage = _defaultSlippage;
        maxRetries = _maxRetries;
    }
    
    /**
     * @notice Emergency pause
     */
    function pause() external onlyEmergencyAdmin {
        paused = true;
    }
    
    /**
     * @notice Unpause contract
     */
    function unpause() external onlyAdmin {
        paused = false;
    }
    
    /**
     * @notice Transfer admin role
     * @param newAdmin New admin address
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin address");
        admin = newAdmin;
    }
    
    // ==================== VIEW FUNCTIONS ====================
    
    /**
     * @notice Get user position in a specific protocol
     * @param user User address
     * @param protocolId Protocol ID
     * @return principal Principal amount
     * @return accruedYield Accrued yield amount
     * @return lastHarvestTime Last harvest timestamp
     * @return isActive Whether position is active
     */
    function getUserPosition(address user, uint256 protocolId) external view returns (
        uint256 principal,
        uint256 accruedYield,
        uint256 lastHarvestTime,
        bool isActive
    ) {
        UserPosition storage position = userPositions[user][protocolId];
        return (position.principal, position.accruedYield, position.lastHarvestTime, position.isActive);
    }
    
    /**
     * @notice Get protocol configuration
     * @param protocolId Protocol ID
     * @return config Protocol configuration
     */
    function getProtocolConfig(uint256 protocolId) external view returns (ProtocolConfig memory config) {
        return protocols[protocolId];
    }
    
    /**
     * @notice Get protocols on a specific chain
     * @param chainId Chain ID
     * @return protocolIds Array of protocol IDs
     */
    function getChainProtocols(uint256 chainId) external view returns (uint256[] memory protocolIds) {
        return chainProtocols[chainId];
    }
    
    /**
     * @notice Get total user value across all protocols
     * @param user User address
     * @return totalValue Total value (principal + yield)
     */
    function getUserTotalValue(address user) external view returns (uint256 totalValue) {
        for (uint256 i = 1; i <= protocolCount; i++) {
            UserPosition storage position = userPositions[user][i];
            if (position.isActive) {
                totalValue += position.principal + position.accruedYield;
            }
        }
        return totalValue;
    }
    
    /**
     * @notice Get cross-chain operation status
     * @param opId Operation ID
     * @return operation Operation details
     */
    function getCrossChainOperation(bytes32 opId) external view returns (CrossChainOperation memory operation) {
        return crossChainOps[opId];
    }
    
    /**
     * @notice Get vault statistics
     * @return totalTvl Total value locked
     * @return totalHarvested Total yield harvested
     * @return activeProtocols Number of active protocols
     */
    function getVaultStats() external view returns (
        uint256 totalTvl,
        uint256 totalHarvested,
        uint256 activeProtocols
    ) {
        uint256 activeCount = 0;
        for (uint256 i = 1; i <= protocolCount; i++) {
            if (protocols[i].isActive) {
                activeCount++;
            }
        }
        
        return (totalTVL, totalYieldHarvested, activeCount);
    }
}