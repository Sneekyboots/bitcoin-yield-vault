// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title IYieldProtocol
 * @notice Interface for yield protocol adapters
 * @dev Standardizes interaction with different DeFi protocols
 */
interface IYieldProtocol {
    // Structs
    struct ProtocolInfo {
        string name;
        address protocolAddress;
        address underlyingToken;
        uint256 currentAPY;
        uint256 totalDeposited;
        bool isActive;
    }
    
    struct UserPosition {
        uint256 principal;
        uint256 shares;
        uint256 accruedYield;
        uint256 lastUpdateTime;
        bool isActive;
    }
    
    // Events
    event Deposit(address indexed user, uint256 amount, uint256 shares);
    event Withdraw(address indexed user, uint256 amount, uint256 shares);
    event YieldHarvested(address indexed user, uint256 yieldAmount);
    event APYUpdated(uint256 oldAPY, uint256 newAPY);
    
    // Core Functions
    function deposit(address user, uint256 amount) external returns (uint256 shares);
    function withdraw(address user, uint256 shares) external returns (uint256 amount);
    function harvestYield(address user) external returns (uint256 yieldAmount);
    function compound(address user) external returns (uint256 newShares);
    
    // View Functions
    function getProtocolInfo() external view returns (ProtocolInfo memory);
    function getUserPosition(address user) external view returns (UserPosition memory);
    function calculateYield(address user) external view returns (uint256);
    function getCurrentAPY() external view returns (uint256);
    function getTotalValueLocked() external view returns (uint256);
    function getSharePrice() external view returns (uint256);
    function balanceOf(address user) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    
    // Admin Functions
    function updateAPY() external returns (uint256 newAPY);
    function emergencyWithdraw(address user) external returns (uint256 amount);
    function setProtocolStatus(bool isActive) external;
}