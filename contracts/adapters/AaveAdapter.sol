// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../interfaces/IYieldProtocol.sol";

// Aave protocol interfaces
interface ILendingPool {
        function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
        function withdraw(address asset, uint256 amount, address to) external returns (uint256);
        function getUserAccountData(address user) external view returns (
            uint256 totalCollateralETH,
            uint256 totalDebtETH,
            uint256 availableBorrowsETH,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
    }
    
    interface IAToken {
        function balanceOf(address user) external view returns (uint256);
        function transfer(address to, uint256 amount) external returns (bool);
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function approve(address spender, uint256 amount) external returns (bool);
        function UNDERLYING_ASSET_ADDRESS() external view returns (address);
    }
    
    interface ILendingPoolAddressesProvider {
        function getLendingPool() external view returns (address);
        function getPriceOracle() external view returns (address);
    }
    
    interface IRewardsController {
        function claimRewards(
            address[] calldata assets,
            uint256 amount,
            address to,
            address reward
        ) external returns (uint256);
        function getUserRewards(
            address[] calldata assets,
            address user,
            address reward
        ) external view returns (uint256);
    }
    
    interface IERC20 {
        function transfer(address to, uint256 amount) external returns (bool);
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function balanceOf(address account) external view returns (uint256);
        function approve(address spender, uint256 amount) external returns (bool);
        function decimals() external view returns (uint8);
    }
    
    interface IPriceOracle {
    function getAssetPrice(address asset) external view returns (uint256);
}

/**
 * @title AaveAdapter
 * @notice Adapter for Aave protocol integration
 * @dev Handles aToken interactions for yield farming
 */
contract AaveAdapter is IYieldProtocol {
    // State variables
    ILendingPool public immutable lendingPool;
    IAToken public immutable aToken;
    IERC20 public immutable underlyingToken;
    IRewardsController public immutable rewardsController;
    IPriceOracle public immutable priceOracle;
    IERC20 public immutable rewardToken; // AAVE token
    
    address public crossChainYield;
    string public protocolName;
    uint256 public totalDeposited;
    uint16 private constant REFERRAL_CODE = 0;
    
    mapping(address => UserPosition) private userPositions;
    mapping(address => bool) public authorizedCallers;
    
    // Events
    event Deposited(address indexed user, uint256 amount, uint256 aTokensReceived);
    event Withdrawn(address indexed user, uint256 amount, uint256 aTokensBurned);
    event YieldClaimed(address indexed user, uint256 rewardsClaimed, uint256 interestEarned);
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
     * @param _lendingPoolProvider Aave lending pool addresses provider
     * @param _aToken Aave aToken address
     * @param _rewardsController Aave rewards controller address
     * @param _rewardToken Reward token address (AAVE)
     * @param _crossChainYield CrossChainYield contract address
     * @param _protocolName Human readable protocol name
     */
    constructor(
        address _lendingPoolProvider,
        address _aToken,
        address _rewardsController,
        address _rewardToken,
        address _crossChainYield,
        string memory _protocolName
    ) {
        require(_lendingPoolProvider != address(0), "Invalid lending pool provider");
        require(_aToken != address(0), "Invalid aToken address");
        require(_crossChainYield != address(0), "Invalid CrossChainYield address");
        
        ILendingPoolAddressesProvider provider = ILendingPoolAddressesProvider(_lendingPoolProvider);
        lendingPool = ILendingPool(provider.getLendingPool());
        priceOracle = IPriceOracle(provider.getPriceOracle());
        
        aToken = IAToken(_aToken);
        underlyingToken = IERC20(IAToken(_aToken).UNDERLYING_ASSET_ADDRESS());
        rewardsController = IRewardsController(_rewardsController);
        rewardToken = IERC20(_rewardToken);
        
        crossChainYield = _crossChainYield;
        protocolName = _protocolName;
        
        // Set initial authorization
        authorizedCallers[_crossChainYield] = true;
        
        // Approve lending pool to spend underlying tokens
        underlyingToken.approve(address(lendingPool), type(uint256).max);
    }
    
    /**
     * @notice Deposit tokens into Aave protocol
     * @param user User address
     * @param amount Amount of underlying tokens to deposit
     * @return shares Amount of aTokens received (1:1 with underlying)
     */
    function deposit(address user, uint256 amount) external override onlyAuthorized validUser(user) returns (uint256 shares) {
        require(amount > 0, "Deposit amount must be greater than 0");
        
        // Transfer underlying tokens from caller
        require(underlyingToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Update user yield before deposit
        _updateUserYield(user);
        
        // Get aToken balance before deposit
        uint256 aTokenBalanceBefore = aToken.balanceOf(address(this));
        
        // Deposit into Aave lending pool
        lendingPool.deposit(address(underlyingToken), amount, address(this), REFERRAL_CODE);
        
        // Calculate aTokens received
        uint256 aTokenBalanceAfter = aToken.balanceOf(address(this));
        uint256 aTokensReceived = aTokenBalanceAfter - aTokenBalanceBefore;
        
        // Update user position
        UserPosition storage position = userPositions[user];
        if (!position.isActive) {
            position.isActive = true;
            position.lastUpdateTime = block.timestamp;
        }
        
        position.principal += amount;
        position.shares += aTokensReceived;
        totalDeposited += amount;
        
        emit Deposited(user, amount, aTokensReceived);
        emit Deposit(user, amount, aTokensReceived);
        
        return aTokensReceived;
    }
    
    /**
     * @notice Withdraw tokens from Aave protocol
     * @param user User address
     * @param shares Amount of aTokens to redeem (0 for all)
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
        
        // Withdraw from Aave lending pool
        uint256 withdrawnAmount = lendingPool.withdraw(address(underlyingToken), sharesToRedeem, user);
        
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
        
        totalDeposited -= (withdrawnAmount > totalDeposited ? totalDeposited : withdrawnAmount);
        
        emit Withdrawn(user, withdrawnAmount, sharesToRedeem);
        emit Withdraw(user, withdrawnAmount, sharesToRedeem);
        
        return withdrawnAmount;
    }
    
    /**
     * @notice Harvest yield for a user
     * @param user User address
     * @return yieldAmount Total yield harvested (interest + rewards)
     */
    function harvestYield(address user) external override onlyAuthorized validUser(user) returns (uint256 yieldAmount) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        // Update accrued yield
        _updateUserYield(user);
        
        // Claim AAVE rewards
        address[] memory assets = new address[](1);
        assets[0] = address(aToken);
        
        uint256 rewardBalance = rewardsController.getUserRewards(assets, address(this), address(rewardToken));
        
        if (rewardBalance > 0) {
            rewardsController.claimRewards(assets, rewardBalance, user, address(rewardToken));
        }
        
        uint256 interestEarned = position.accruedYield;
        yieldAmount = interestEarned; // + converted reward value (implementation dependent)
        
        // Reset accrued yield
        position.accruedYield = 0;
        position.lastUpdateTime = block.timestamp;
        
        emit YieldClaimed(user, rewardBalance, interestEarned);
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
        
        // In Aave, interest is automatically compounded as aToken balance grows
        // So we just need to update the position to reflect the compounded yield
        position.principal += yieldToCompound;
        position.accruedYield = 0;
        totalDeposited += yieldToCompound;
        
        emit CompoundedYield(user, yieldToCompound);
        
        // Return the yield amount as "new shares" since aTokens represent 1:1 with underlying + interest
        return yieldToCompound;
    }
    
    /**
     * @notice Update user's accrued yield based on aToken balance growth
     * @param user User address
     */
    function _updateUserYield(address user) internal {
        UserPosition storage position = userPositions[user];
        
        if (!position.isActive || position.shares == 0) {
            return;
        }
        
        // In Aave, aTokens automatically accrue interest
        // Current balance includes principal + accrued interest
        uint256 currentBalance = position.shares; // aTokens represent 1:1 with underlying + interest
        
        // Calculate yield as difference between current balance and principal
        if (currentBalance > position.principal) {
            uint256 newYield = currentBalance - position.principal;
            position.accruedYield = newYield;
        }
        
        position.lastUpdateTime = block.timestamp;
    }
    
    // View functions
    function getProtocolInfo() external view override returns (ProtocolInfo memory) {
        return ProtocolInfo({
            name: protocolName,
            protocolAddress: address(lendingPool),
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
        
        // Current aToken balance includes accrued interest
        uint256 currentBalance = position.shares;
        
        // Return yield as difference between current balance and principal
        if (currentBalance > position.principal) {
            return currentBalance - position.principal;
        }
        
        return 0;
    }
    
    function getCurrentAPY() public view override returns (uint256) {
        // Note: Aave V3 has different rate calculation methods
        // This is a simplified implementation
        // In practice, you would need to get the current liquidity rate from the reserve data
        
        // For demonstration, returning a fixed APY
        // Real implementation would fetch from Aave's reserve data
        return 300; // 3% APY in basis points
    }
    
    function getTotalValueLocked() external view override returns (uint256) {
        return totalDeposited;
    }
    
    function getSharePrice() external view override returns (uint256) {
        // aTokens are 1:1 with underlying + interest, so price is always 1
        return 1e18;
    }
    
    function balanceOf(address user) external view override returns (uint256) {
        return userPositions[user].shares;
    }
    
    function totalSupply() external view override returns (uint256) {
        return aToken.balanceOf(address(this));
    }
    
    // Admin functions
    function updateAPY() external override returns (uint256 newAPY) {
        // APY is automatically updated from Aave protocol
        return getCurrentAPY();
    }
    
    function emergencyWithdraw(address user) external override onlyAuthorized returns (uint256 amount) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        uint256 sharesToWithdraw = position.shares;
        
        // Emergency withdraw all aTokens
        uint256 withdrawnAmount = lendingPool.withdraw(address(underlyingToken), sharesToWithdraw, user);
        
        // Reset user position
        position.principal = 0;
        position.shares = 0;
        position.accruedYield = 0;
        position.isActive = false;
        
        return withdrawnAmount;
    }
    
    function setProtocolStatus(bool isActive) external override {
        // Implementation depends on access control requirements
        // For now, Aave protocol status is managed externally
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
    
    // Additional helper functions
    function getUserAccountData(address user) external view returns (
        uint256 totalCollateralETH,
        uint256 totalDebtETH,
        uint256 availableBorrowsETH,
        uint256 currentLiquidationThreshold,
        uint256 ltv,
        uint256 healthFactor
    ) {
        return lendingPool.getUserAccountData(user);
    }
    
    function getAssetPrice() external view returns (uint256) {
        return priceOracle.getAssetPrice(address(underlyingToken));
    }
    
    function getPendingRewards(address user) external view returns (uint256) {
        address[] memory assets = new address[](1);
        assets[0] = address(aToken);
        return rewardsController.getUserRewards(assets, user, address(rewardToken));
    }
}