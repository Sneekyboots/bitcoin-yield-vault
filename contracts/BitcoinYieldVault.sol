// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@zetachain/protocol-contracts/contracts/zevm/SystemContract.sol";
import "@zetachain/protocol-contracts/contracts/zevm/interfaces/UniversalContract.sol";
import "@zetachain/protocol-contracts/contracts/zevm/interfaces/IZRC20.sol";
import "@zetachain/protocol-contracts/contracts/Revert.sol";

/**
 * @title BitcoinYieldVault
 * @notice Omnichain Bitcoin Yield Vault - Enables Bitcoin holders to earn yield across multiple DeFi protocols
 * @dev Universal Smart Contract implementing ZetaChain's cross-chain capabilities
 */
contract BitcoinYieldVault is UniversalContract, Revertable, Abortable {
    // State variables
    SystemContract public immutable systemContract;
    
    // User deposit tracking
    struct UserDeposit {
        uint256 principal;          // Original BTC deposit amount in satoshis
        uint256 accruedYield;      // Accumulated yield in satoshis
        uint256 lastUpdateTime;    // Last yield calculation timestamp
        bool isActive;             // Whether deposit is active
        mapping(uint256 => uint256) chainBalances; // Balance per chain ID
    }
    
    // Yield protocol information
    struct YieldProtocol {
        address protocolAddress;    // Protocol contract address
        uint256 chainId;           // Chain where protocol exists
        uint256 currentAPY;        // Current APY in basis points (10000 = 100%)
        bool isActive;             // Whether protocol is active
        uint256 totalDeployed;     // Total amount deployed to this protocol
        uint256 lastYieldUpdate;   // Last yield update timestamp
    }
    
    // Cross-chain transaction tracking
    struct CrossChainTx {
        address user;
        uint256 amount;
        uint256 targetChain;
        address targetProtocol;
        uint256 timestamp;
        TxStatus status;
    }
    
    enum TxStatus {
        Pending,
        Completed,
        Failed,
        Reverted
    }
    
    // Mappings
    mapping(address => UserDeposit) public userDeposits;
    mapping(uint256 => YieldProtocol) public yieldProtocols; // protocol ID => protocol info
    mapping(bytes32 => CrossChainTx) public crossChainTxs;
    mapping(uint256 => address) public chainToZRC20; // chain ID => ZRC20 token address
    
    // State tracking
    uint256 public totalBitcoinDeposited;
    uint256 public totalYieldGenerated;
    uint256 public protocolCount;
    uint256 public performanceFee = 1000; // 10% in basis points
    address public treasury;
    address public admin;
    bool public vaultPaused;
    
    // Constants
    uint256 private constant SATOSHIS_PER_BTC = 100_000_000;
    uint256 private constant BASIS_POINTS = 10_000;
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    
    // Events
    event BitcoinDeposited(address indexed user, uint256 amount, uint256 timestamp);
    event YieldDeployed(address indexed user, uint256 amount, uint256 targetChain, address protocol);
    event YieldHarvested(address indexed user, uint256 yieldAmount, uint256 timestamp);
    event Withdrawal(address indexed user, uint256 principal, uint256 yield, uint256 timestamp);
    event CrossChainCallInitiated(bytes32 indexed txId, address user, uint256 amount, uint256 targetChain);
    event CrossChainCallCompleted(bytes32 indexed txId, bool success);
    event ProtocolAdded(uint256 indexed protocolId, address protocolAddress, uint256 chainId);
    event ProtocolUpdated(uint256 indexed protocolId, uint256 newAPY, bool isActive);
    event EmergencyRefund(address indexed user, uint256 amount, string reason);
    
    // Modifiers
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this function");
        _;
    }
    
    modifier whenNotPaused() {
        require(!vaultPaused, "Vault is paused");
        _;
    }
    
    modifier validUser(address user) {
        require(user != address(0), "Invalid user address");
        _;
    }
    
    modifier hasDeposit(address user) {
        require(userDeposits[user].isActive, "User has no active deposit");
        _;
    }
    
    /**
     * @notice Constructor
     * @param _systemContract ZetaChain system contract address
     * @param _treasury Treasury address for fees
     */
    constructor(address _systemContract, address _treasury) {
        systemContract = SystemContract(_systemContract);
        admin = msg.sender;
        treasury = _treasury;
        vaultPaused = false;
    }
    
    /**
     * @notice Deposit Bitcoin directly via ZetaChain TSS gateway
     * @param amount Amount of Bitcoin in satoshis
     */
    function depositBitcoin(uint256 amount) external whenNotPaused {
        require(amount > 0, "Deposit amount must be greater than 0");
        require(amount >= 1000, "Minimum deposit is 1000 satoshis");
        
        UserDeposit storage deposit = userDeposits[msg.sender];
        
        if (!deposit.isActive) {
            deposit.isActive = true;
            deposit.lastUpdateTime = block.timestamp;
        } else {
            // Update yield before adding new deposit
            _updateUserYield(msg.sender);
        }
        
        deposit.principal += amount;
        totalBitcoinDeposited += amount;
        
        emit BitcoinDeposited(msg.sender, amount, block.timestamp);
        
        // Automatically deploy to best yield protocols
        _deployToYieldProtocols(msg.sender, amount);
    }
    
    /**
     * @notice Deploy funds to yield protocols across chains
     * @param user User address
     * @param amount Amount to deploy
     */
    function _deployToYieldProtocols(address user, uint256 amount) internal {
        // Find best yield protocol
        uint256 bestProtocolId = _getBestYieldProtocol();
        
        if (bestProtocolId != 0) {
            YieldProtocol storage protocol = yieldProtocols[bestProtocolId];
            
            // Create cross-chain transaction
            bytes32 txId = keccak256(abi.encodePacked(user, amount, protocol.chainId, block.timestamp));
            
            crossChainTxs[txId] = CrossChainTx({
                user: user,
                amount: amount,
                targetChain: protocol.chainId,
                targetProtocol: protocol.protocolAddress,
                timestamp: block.timestamp,
                status: TxStatus.Pending
            });
            
            // Update user's chain balance
            userDeposits[user].chainBalances[protocol.chainId] += amount;
            protocol.totalDeployed += amount;
            
            emit CrossChainCallInitiated(txId, user, amount, protocol.chainId);
            emit YieldDeployed(user, amount, protocol.chainId, protocol.protocolAddress);
            
            // Initiate cross-chain call
            _initiateCrossChainCall(txId, amount, protocol.chainId, protocol.protocolAddress);
        }
    }
    
    /**
     * @notice Initiate cross-chain call to deploy funds
     * @param txId Transaction ID
     * @param amount Amount to deploy
     * @param targetChain Target chain ID
     * @param targetProtocol Target protocol address
     */
    function _initiateCrossChainCall(
        bytes32 txId,
        uint256 amount,
        uint256 targetChain,
        address targetProtocol
    ) internal {
        address zrc20 = chainToZRC20[targetChain];
        require(zrc20 != address(0), "Unsupported target chain");
        
        // Prepare call data for yield protocol interaction
        bytes memory message = abi.encode(txId, amount, targetProtocol);
        
        // Execute cross-chain call through ZetaChain gateway
        IZRC20(zrc20).deposit(targetProtocol, amount);
        
        // The actual cross-chain execution will trigger onCall, onRevert, or onAbort
    }
    
    /**
     * @notice Universal Contract onCall - Handle successful cross-chain calls
     * @param context Cross-chain call context
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
        // Decode message
        (bytes32 txId, uint256 deployAmount, address targetProtocol) = abi.decode(
            message,
            (bytes32, uint256, address)
        );
        
        CrossChainTx storage txInfo = crossChainTxs[txId];
        require(txInfo.status == TxStatus.Pending, "Transaction not pending");
        
        // Update transaction status
        txInfo.status = TxStatus.Completed;
        
        // Update protocol deployment
        uint256 protocolId = _getProtocolIdByAddress(targetProtocol);
        if (protocolId != 0) {
            yieldProtocols[protocolId].totalDeployed += deployAmount;
            yieldProtocols[protocolId].lastYieldUpdate = block.timestamp;
        }
        
        emit CrossChainCallCompleted(txId, true);
        
        // Interact with yield protocol (Compound, Aave, etc.)
        _interactWithYieldProtocol(targetProtocol, deployAmount, true);
    }
    
    /**
     * @notice Universal Contract onRevert - Handle failed cross-chain calls
     * @param context Revert context containing sender, asset, amount, and message
     */
    function onRevert(
        RevertContext calldata context
    ) external override {
        // Decode message from revert context
        (bytes32 txId, uint256 deployAmount, address targetProtocol) = abi.decode(
            context.revertMessage,
            (bytes32, uint256, address)
        );
        
        CrossChainTx storage txInfo = crossChainTxs[txId];
        require(txInfo.status == TxStatus.Pending, "Transaction not pending");
        
        // Update transaction status
        txInfo.status = TxStatus.Reverted;
        
        // Revert user's chain balance
        userDeposits[txInfo.user].chainBalances[txInfo.targetChain] -= deployAmount;
        
        // Find alternative protocol or refund
        uint256 alternativeProtocol = _getAlternativeProtocol(txInfo.targetChain);
        
        if (alternativeProtocol != 0) {
            // Try alternative protocol
            _deployToSpecificProtocol(txInfo.user, deployAmount, alternativeProtocol);
        } else {
            // Emergency refund
            _emergencyRefund(txInfo.user, deployAmount, "Cross-chain call reverted");
        }
        
        emit CrossChainCallCompleted(txId, false);
    }
    
    /**
     * @notice Universal Contract onAbort - Handle aborted cross-chain calls
     * @param context Abort context containing sender, asset, amount, and message
     */
    function onAbort(
        AbortContext calldata context
    ) external override {
        // Decode message from abort context
        (bytes32 txId, uint256 deployAmount, address targetProtocol) = abi.decode(
            context.revertMessage,
            (bytes32, uint256, address)
        );
        
        CrossChainTx storage txInfo = crossChainTxs[txId];
        require(txInfo.status == TxStatus.Pending, "Transaction not pending");
        
        // Update transaction status
        txInfo.status = TxStatus.Failed;
        
        // Emergency refund to user
        _emergencyRefund(txInfo.user, deployAmount, "Cross-chain call aborted");
        
        emit CrossChainCallCompleted(txId, false);
    }
    
    /**
     * @notice Withdraw principal and accrued yield
     * @param amount Amount to withdraw (0 for full withdrawal)
     */
    function withdraw(uint256 amount) external hasDeposit(msg.sender) whenNotPaused {
        UserDeposit storage deposit = userDeposits[msg.sender];
        
        // Update yield before withdrawal
        _updateUserYield(msg.sender);
        
        uint256 totalAvailable = deposit.principal + deposit.accruedYield;
        uint256 withdrawAmount = amount == 0 ? totalAvailable : amount;
        
        require(withdrawAmount <= totalAvailable, "Insufficient balance");
        require(withdrawAmount > 0, "Withdrawal amount must be greater than 0");
        
        // Calculate performance fee on yield portion
        uint256 yieldPortion = withdrawAmount > deposit.principal ? 
            withdrawAmount - deposit.principal : 0;
        uint256 fee = (yieldPortion * performanceFee) / BASIS_POINTS;
        uint256 netWithdraw = withdrawAmount - fee;
        
        // Update user deposit
        if (withdrawAmount >= totalAvailable) {
            // Full withdrawal
            deposit.principal = 0;
            deposit.accruedYield = 0;
            deposit.isActive = false;
        } else {
            // Partial withdrawal - reduce proportionally
            uint256 remainingRatio = ((totalAvailable - withdrawAmount) * BASIS_POINTS) / totalAvailable;
            deposit.principal = (deposit.principal * remainingRatio) / BASIS_POINTS;
            deposit.accruedYield = (deposit.accruedYield * remainingRatio) / BASIS_POINTS;
        }
        
        // Update global state
        totalBitcoinDeposited -= (withdrawAmount - yieldPortion);
        
        // Transfer fee to treasury
        if (fee > 0) {
            // Transfer fee logic here
        }
        
        emit Withdrawal(msg.sender, withdrawAmount - yieldPortion, yieldPortion, block.timestamp);
        
        // Execute cross-chain withdrawal
        _executeCrossChainWithdrawal(msg.sender, netWithdraw);
    }
    
    /**
     * @notice Update user's accrued yield
     * @param user User address
     */
    function _updateUserYield(address user) internal {
        UserDeposit storage deposit = userDeposits[user];
        
        if (!deposit.isActive || deposit.principal == 0) {
            return;
        }
        
        uint256 timeElapsed = block.timestamp - deposit.lastUpdateTime;
        uint256 averageAPY = _calculateUserAverageAPY(user);
        
        if (timeElapsed > 0 && averageAPY > 0) {
            uint256 yieldAccrued = (deposit.principal * averageAPY * timeElapsed) / 
                (BASIS_POINTS * SECONDS_PER_YEAR);
            
            deposit.accruedYield += yieldAccrued;
            deposit.lastUpdateTime = block.timestamp;
            totalYieldGenerated += yieldAccrued;
            
            emit YieldHarvested(user, yieldAccrued, block.timestamp);
        }
    }
    
    /**
     * @notice Calculate user's average APY across all deployed protocols
     * @param user User address
     * @return Average APY in basis points
     */
    function _calculateUserAverageAPY(address user) internal view returns (uint256) {
        UserDeposit storage deposit = userDeposits[user];
        uint256 totalBalance = 0;
        uint256 weightedAPY = 0;
        
        for (uint256 i = 1; i <= protocolCount; i++) {
            YieldProtocol storage protocol = yieldProtocols[i];
            uint256 userBalance = deposit.chainBalances[protocol.chainId];
            
            if (userBalance > 0 && protocol.isActive) {
                totalBalance += userBalance;
                weightedAPY += userBalance * protocol.currentAPY;
            }
        }
        
        return totalBalance > 0 ? weightedAPY / totalBalance : 0;
    }
    
    /**
     * @notice Get best yield protocol based on APY
     * @return Protocol ID with highest APY
     */
    function _getBestYieldProtocol() internal view returns (uint256) {
        uint256 bestProtocolId = 0;
        uint256 bestAPY = 0;
        
        for (uint256 i = 1; i <= protocolCount; i++) {
            YieldProtocol storage protocol = yieldProtocols[i];
            if (protocol.isActive && protocol.currentAPY > bestAPY) {
                bestAPY = protocol.currentAPY;
                bestProtocolId = i;
            }
        }
        
        return bestProtocolId;
    }
    
    /**
     * @notice Emergency refund to user
     * @param user User address
     * @param amount Amount to refund
     * @param reason Reason for refund
     */
    function _emergencyRefund(address user, uint256 amount, string memory reason) internal {
        UserDeposit storage deposit = userDeposits[user];
        deposit.principal += amount;
        
        emit EmergencyRefund(user, amount, reason);
    }
    
    /**
     * @notice Execute cross-chain withdrawal
     * @param user User address
     * @param amount Amount to withdraw
     */
    function _executeCrossChainWithdrawal(address user, uint256 amount) internal {
        // Implementation for cross-chain Bitcoin withdrawal via TSS
        // This would interact with ZetaChain's gateway to send BTC back to user
    }
    
    /**
     * @notice Interact with external yield protocol
     * @param protocolAddress Protocol contract address
     * @param amount Amount to deploy/withdraw
     * @param isDeposit True for deposit, false for withdrawal
     */
    function _interactWithYieldProtocol(
        address protocolAddress, 
        uint256 amount, 
        bool isDeposit
    ) internal {
        // Implementation would depend on specific protocol (Compound, Aave, etc.)
        // This is a placeholder for protocol-specific interactions
    }
    
    // Additional helper functions
    function _getProtocolIdByAddress(address protocolAddress) internal view returns (uint256) {
        for (uint256 i = 1; i <= protocolCount; i++) {
            if (yieldProtocols[i].protocolAddress == protocolAddress) {
                return i;
            }
        }
        return 0;
    }
    
    function _getAlternativeProtocol(uint256 excludeChain) internal view returns (uint256) {
        for (uint256 i = 1; i <= protocolCount; i++) {
            YieldProtocol storage protocol = yieldProtocols[i];
            if (protocol.isActive && protocol.chainId != excludeChain) {
                return i;
            }
        }
        return 0;
    }
    
    function _deployToSpecificProtocol(address user, uint256 amount, uint256 protocolId) internal {
        YieldProtocol storage protocol = yieldProtocols[protocolId];
        
        bytes32 txId = keccak256(abi.encodePacked(user, amount, protocol.chainId, block.timestamp, "retry"));
        
        crossChainTxs[txId] = CrossChainTx({
            user: user,
            amount: amount,
            targetChain: protocol.chainId,
            targetProtocol: protocol.protocolAddress,
            timestamp: block.timestamp,
            status: TxStatus.Pending
        });
        
        userDeposits[user].chainBalances[protocol.chainId] += amount;
        protocol.totalDeployed += amount;
        
        emit CrossChainCallInitiated(txId, user, amount, protocol.chainId);
        _initiateCrossChainCall(txId, amount, protocol.chainId, protocol.protocolAddress);
    }
    
    // Admin functions
    function addYieldProtocol(
        address protocolAddress,
        uint256 chainId,
        uint256 apy
    ) external onlyAdmin {
        protocolCount++;
        yieldProtocols[protocolCount] = YieldProtocol({
            protocolAddress: protocolAddress,
            chainId: chainId,
            currentAPY: apy,
            isActive: true,
            totalDeployed: 0,
            lastYieldUpdate: block.timestamp
        });
        
        emit ProtocolAdded(protocolCount, protocolAddress, chainId);
    }
    
    function updateProtocol(uint256 protocolId, uint256 newAPY, bool isActive) external onlyAdmin {
        require(protocolId <= protocolCount, "Invalid protocol ID");
        
        yieldProtocols[protocolId].currentAPY = newAPY;
        yieldProtocols[protocolId].isActive = isActive;
        
        emit ProtocolUpdated(protocolId, newAPY, isActive);
    }
    
    function setChainZRC20(uint256 chainId, address zrc20Address) external onlyAdmin {
        chainToZRC20[chainId] = zrc20Address;
    }
    
    function setPerformanceFee(uint256 newFee) external onlyAdmin {
        require(newFee <= 2000, "Fee cannot exceed 20%"); // Max 20%
        performanceFee = newFee;
    }
    
    function pauseVault() external onlyAdmin {
        vaultPaused = true;
    }
    
    function unpauseVault() external onlyAdmin {
        vaultPaused = false;
    }
    
    function setTreasury(address newTreasury) external onlyAdmin {
        require(newTreasury != address(0), "Invalid treasury address");
        treasury = newTreasury;
    }
    
    // View functions
    function getUserDeposit(address user) external view returns (
        uint256 principal,
        uint256 accruedYield,
        uint256 lastUpdateTime,
        bool isActive
    ) {
        UserDeposit storage deposit = userDeposits[user];
        return (deposit.principal, deposit.accruedYield, deposit.lastUpdateTime, deposit.isActive);
    }
    
    function getUserChainBalance(address user, uint256 chainId) external view returns (uint256) {
        return userDeposits[user].chainBalances[chainId];
    }
    
    function getProtocolInfo(uint256 protocolId) external view returns (
        address protocolAddress,
        uint256 chainId,
        uint256 currentAPY,
        bool isActive,
        uint256 totalDeployed
    ) {
        YieldProtocol storage protocol = yieldProtocols[protocolId];
        return (
            protocol.protocolAddress,
            protocol.chainId,
            protocol.currentAPY,
            protocol.isActive,
            protocol.totalDeployed
        );
    }
    
    function getTotalStats() external view returns (
        uint256 totalDeposited,
        uint256 totalYield,
        uint256 activeProtocols
    ) {
        uint256 activeCount = 0;
        for (uint256 i = 1; i <= protocolCount; i++) {
            if (yieldProtocols[i].isActive) {
                activeCount++;
            }
        }
        
        return (totalBitcoinDeposited, totalYieldGenerated, activeCount);
    }
    
    function getCrossChainTxStatus(bytes32 txId) external view returns (
        address user,
        uint256 amount,
        uint256 targetChain,
        TxStatus status
    ) {
        CrossChainTx storage txInfo = crossChainTxs[txId];
        return (txInfo.user, txInfo.amount, txInfo.targetChain, txInfo.status);
    }
}
