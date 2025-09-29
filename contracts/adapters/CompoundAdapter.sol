// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../interfaces/IYieldProtocol.sol";

// Compound protocol interfaces
interface ICToken {
    function mint(uint256 mintAmount) external returns (uint256);
    function redeem(uint256 redeemTokens) external returns (uint256);
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function balanceOfUnderlying(address owner) external returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function supplyRatePerBlock() external view returns (uint256);
    function underlying() external view returns (address);
}

interface IERC20 {
        function transfer(address to, uint256 amount) external returns (bool);
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function balanceOf(address account) external view returns (uint256);
        function approve(address spender, uint256 amount) external returns (bool);
        function decimals() external view returns (uint8);
    }
    
    interface IComptroller {
    function claimComp(address holder) external;
    function getCompAddress() external view returns (address);
}

/**
 * @title CompoundAdapter
 * @notice Adapter for Compound protocol integration
 * @dev Handles cToken interactions for yield farming
 */
contract CompoundAdapter is IYieldProtocol {
    // State variables
    ICToken public immutable cToken;
    IERC20 public immutable underlyingToken;
    IComptroller public immutable comptroller;
    IERC20 public immutable compToken;
    
    address public crossChainYield;
    string public protocolName;
    uint256 public totalDeposited;
    uint256 private constant BLOCKS_PER_YEAR = 2_102_400; // Approximate blocks per year
    
    mapping(address => UserPosition) private userPositions;
    mapping(address => bool) public authorizedCallers;
    
    // Events
    event Deposited(address indexed user, uint256 amount, uint256 cTokensReceived);
    event Withdrawn(address indexed user, uint256 amount, uint256 cTokensBurned);
    event YieldClaimed(address indexed user, uint256 compRewards, uint256 interestEarned);
    event CompoundedYield(address indexed user, uint256 amount);
    
    // Modifiers
    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender] || msg.sender == crossChainYield, "Not authorized");
        _;
    }
    
    modifier validUser(address user) {
        require(user != address(0), "Invalid user address");
        _;
    }
    
    /**
     * @notice Constructor
     * @param _cToken Compound cToken address
     * @param _comptroller Compound comptroller address
     * @param _crossChainYield CrossChainYield contract address
     * @param _protocolName Human readable protocol name
     */
    constructor(
        address _cToken,
        address _comptroller,
        address _crossChainYield,
        string memory _protocolName
    ) {
        require(_cToken != address(0), "Invalid cToken address");
        require(_comptroller != address(0), "Invalid comptroller address");
        require(_crossChainYield != address(0), "Invalid CrossChainYield address");
        
        cToken = ICToken(_cToken);
        comptroller = IComptroller(_comptroller);
        underlyingToken = IERC20(ICToken(_cToken).underlying());
        compToken = IERC20(IComptroller(_comptroller).getCompAddress());
        crossChainYield = _crossChainYield;
        protocolName = _protocolName;
        
        // Set initial authorization
        authorizedCallers[_crossChainYield] = true;
        
        // Approve cToken to spend underlying tokens
        underlyingToken.approve(_cToken, type(uint256).max);
    }
    
    /**
     * @notice Deposit tokens into Compound protocol
     * @param user User address
     * @param amount Amount of underlying tokens to deposit
     * @return shares Amount of cTokens received
     */
    function deposit(address user, uint256 amount) external override onlyAuthorized validUser(user) returns (uint256 shares) {
        require(amount > 0, "Deposit amount must be greater than 0");
        
        // Transfer underlying tokens from caller
        require(underlyingToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Update user yield before deposit
        _updateUserYield(user);
        
        // Mint cTokens by supplying underlying tokens
        uint256 mintResult = cToken.mint(amount);
        require(mintResult == 0, "Compound mint failed");
        
        // Calculate cTokens received
        uint256 cTokenBalance = cToken.balanceOf(address(this));
        uint256 cTokensReceived = cTokenBalance;
        
        // Update user position
        UserPosition storage position = userPositions[user];
        if (!position.isActive) {
            position.isActive = true;
            position.lastUpdateTime = block.timestamp;
        }
        
        position.principal += amount;
        position.shares += cTokensReceived;
        totalDeposited += amount;
        
        emit Deposited(user, amount, cTokensReceived);
        emit Deposit(user, amount, cTokensReceived);
        
        return cTokensReceived;
    }
    
    /**
     * @notice Withdraw tokens from Compound protocol
     * @param user User address
     * @param shares Amount of cTokens to redeem (0 for all)
     * @return amount Amount of underlying tokens received
     */
    function withdraw(address user, uint256 shares) external override onlyAuthorized validUser(user) returns (uint256 amount) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        // Update user yield before withdrawal
        _updateUserYield(user);
        
        uint256 sharesToRedeem = shares == 0 ? position.shares : shares;
        require(sharesToRedeem <= position.shares, "Insufficient shares");
        require(sharesToRedeem > 0, "Shares must be greater than 0");
        
        // Get current exchange rate to calculate underlying amount
        uint256 exchangeRate = cToken.exchangeRateStored();
        uint256 underlyingAmount = (sharesToRedeem * exchangeRate) / 1e18;
        
        // Redeem cTokens for underlying tokens
        uint256 redeemResult = cToken.redeem(sharesToRedeem);
        require(redeemResult == 0, "Compound redeem failed");
        
        // Update user position
        position.shares -= sharesToRedeem;
        if (shares == 0 || position.shares == 0) {
            // Full withdrawal
            position.principal = 0;
            position.accruedYield = 0;
            position.isActive = false;
        } else {
            // Partial withdrawal - reduce principal proportionally
            uint256 principalReduction = (position.principal * sharesToRedeem) / (position.shares + sharesToRedeem);
            position.principal -= principalReduction;
        }
        
        totalDeposited -= (underlyingAmount > totalDeposited ? totalDeposited : underlyingAmount);
        
        // Transfer underlying tokens to user
        require(underlyingToken.transfer(user, underlyingAmount), "Transfer failed");
        
        emit Withdrawn(user, underlyingAmount, sharesToRedeem);
        emit Withdraw(user, underlyingAmount, sharesToRedeem);
        
        return underlyingAmount;
    }
    
    /**
     * @notice Harvest yield for a user
     * @param user User address
     * @return yieldAmount Total yield harvested (interest + COMP rewards)
     */
    function harvestYield(address user) external override onlyAuthorized validUser(user) returns (uint256 yieldAmount) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        // Update accrued yield
        _updateUserYield(user);
        
        // Claim COMP rewards
        address[] memory holders = new address[](1);
        holders[0] = address(this);
        comptroller.claimComp(address(this));
        
        uint256 compBalance = compToken.balanceOf(address(this));
        uint256 interestEarned = position.accruedYield;
        
        yieldAmount = interestEarned; // + converted COMP value (implementation dependent)
        
        // Reset accrued yield
        position.accruedYield = 0;
        position.lastUpdateTime = block.timestamp;
        
        // Transfer COMP rewards to user (if any)
        if (compBalance > 0) {
            compToken.transfer(user, compBalance);
        }
        
        emit YieldClaimed(user, compBalance, interestEarned);
        emit YieldHarvested(user, yieldAmount);
        
        return yieldAmount;
    }
    
    /**
     * @notice Compound yield by reinvesting
     * @param user User address
     * @return newShares New shares received from compounding
     */
    function compound(address user) external override onlyAuthorized validUser(user) returns (uint256 newShares) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        // Update accrued yield
        _updateUserYield(user);
        
        uint256 yieldToCompound = position.accruedYield;
        require(yieldToCompound > 0, "No yield to compound");
        
        // Reset accrued yield
        position.accruedYield = 0;
        
        // Reinvest yield by minting more cTokens
        // Note: This assumes we have the underlying tokens available
        // In practice, this might require converting cToken interest to underlying tokens
        
        uint256 mintResult = cToken.mint(yieldToCompound);
        require(mintResult == 0, "Compound mint failed for compounding");
        
        // Calculate new cTokens received
        uint256 currentBalance = cToken.balanceOf(address(this));
        newShares = currentBalance - position.shares;
        
        // Update position
        position.shares += newShares;
        position.principal += yieldToCompound;
        totalDeposited += yieldToCompound;
        
        emit CompoundedYield(user, yieldToCompound);
        
        return newShares;
    }
    
    /**
     * @notice Update user's accrued yield based on cToken balance growth
     * @param user User address
     */
    function _updateUserYield(address user) internal {
        UserPosition storage position = userPositions[user];
        
        if (!position.isActive || position.shares == 0) {
            return;
        }
        
        // Calculate current underlying balance
        uint256 exchangeRate = cToken.exchangeRateStored();
        uint256 currentUnderlyingBalance = (position.shares * exchangeRate) / 1e18;
        
        // Calculate yield as difference between current balance and principal
        if (currentUnderlyingBalance > position.principal) {
            uint256 newYield = currentUnderlyingBalance - position.principal;
            position.accruedYield = newYield;
        }
        
        position.lastUpdateTime = block.timestamp;
    }
    
    // View functions
    function getProtocolInfo() external view override returns (ProtocolInfo memory) {
        return ProtocolInfo({
            name: protocolName,
            protocolAddress: address(cToken),
            underlyingToken: address(underlyingToken),
            currentAPY: getCurrentAPY(),
            totalDeposited: totalDeposited,
            isActive: true
        });
    }
    
    function getUserPosition(address user) external view override returns (UserPosition memory) {
        return userPositions[user];
    }
    
    function calculateYield(address user) external view override returns (uint256) {
        UserPosition storage position = userPositions[user];
        
        if (!position.isActive || position.shares == 0) {
            return position.accruedYield;
        }
        
        // Calculate current underlying balance
        uint256 exchangeRate = cToken.exchangeRateStored();
        uint256 currentUnderlyingBalance = (position.shares * exchangeRate) / 1e18;
        
        // Return yield as difference between current balance and principal
        if (currentUnderlyingBalance > position.principal) {
            return currentUnderlyingBalance - position.principal;
        }
        
        return 0;
    }
    
    function getCurrentAPY() public view override returns (uint256) {
        uint256 supplyRatePerBlock = cToken.supplyRatePerBlock();
        // Convert to annual APY: ((1 + supplyRatePerBlock) ^ BLOCKS_PER_YEAR - 1) * 10000
        // Simplified calculation for demonstration
        return (supplyRatePerBlock * BLOCKS_PER_YEAR * 10000) / 1e18;
    }
    
    function getTotalValueLocked() external view override returns (uint256) {
        return totalDeposited;
    }
    
    function getSharePrice() external view override returns (uint256) {
        return cToken.exchangeRateStored();
    }
    
    function balanceOf(address user) external view override returns (uint256) {
        return userPositions[user].shares;
    }
    
    function totalSupply() external view override returns (uint256) {
        return cToken.balanceOf(address(this));
    }
    
    // Admin functions
    function updateAPY() external override returns (uint256 newAPY) {
        // APY is automatically updated from Compound protocol
        return getCurrentAPY();
    }
    
    function emergencyWithdraw(address user) external override onlyAuthorized returns (uint256 amount) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        uint256 sharesToRedeem = position.shares;
        
        // Emergency redeem all cTokens
        uint256 redeemResult = cToken.redeem(sharesToRedeem);
        require(redeemResult == 0, "Emergency redeem failed");
        
        // Get redeemed amount
        uint256 underlyingBalance = underlyingToken.balanceOf(address(this));
        
        // Reset user position
        position.principal = 0;
        position.shares = 0;
        position.accruedYield = 0;
        position.isActive = false;
        
        // Transfer all underlying tokens to user
        require(underlyingToken.transfer(user, underlyingBalance), "Emergency transfer failed");
        
        return underlyingBalance;
    }
    
    function setProtocolStatus(bool isActive) external override {
        // Implementation depends on access control requirements
        // For now, Compound protocol status is managed externally
    }
    
    // Authorization management
    function setAuthorizedCaller(address caller, bool authorized) external {
        require(msg.sender == crossChainYield, "Only CrossChainYield can set authorization");
        authorizedCallers[caller] = authorized;
    }
    
    function setCrossChainYield(address newCrossChainYield) external {
        require(msg.sender == crossChainYield, "Only current CrossChainYield can update");
        require(newCrossChainYield != address(0), "Invalid address");
        
        authorizedCallers[crossChainYield] = false;
        crossChainYield = newCrossChainYield;
        authorizedCallers[newCrossChainYield] = true;
    }
}