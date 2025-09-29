// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../interfaces/IYieldProtocol.sol";

// QuickSwap interfaces
interface IQuickSwapRouter {
        function addLiquidity(
            address tokenA,
            address tokenB,
            uint256 amountADesired,
            uint256 amountBDesired,
            uint256 amountAMin,
            uint256 amountBMin,
            address to,
            uint256 deadline
        ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
        
        function removeLiquidity(
            address tokenA,
            address tokenB,
            uint256 liquidity,
            uint256 amountAMin,
            uint256 amountBMin,
            address to,
            uint256 deadline
        ) external returns (uint256 amountA, uint256 amountB);
        
        function swapExactTokensForTokens(
            uint256 amountIn,
            uint256 amountOutMin,
            address[] calldata path,
            address to,
            uint256 deadline
        ) external returns (uint256[] memory amounts);
        
        function getAmountsOut(uint256 amountIn, address[] calldata path)
            external view returns (uint256[] memory amounts);
    }
    
    interface IStakingRewards {
        function stake(uint256 amount) external;
        function withdraw(uint256 amount) external;
        function getReward() external;
        function exit() external;
        function balanceOf(address account) external view returns (uint256);
        function earned(address account) external view returns (uint256);
        function rewardRate() external view returns (uint256);
        function totalSupply() external view returns (uint256);
    }
    
    interface ILPToken {
        function totalSupply() external view returns (uint256);
        function balanceOf(address owner) external view returns (uint256);
        function transfer(address to, uint256 value) external returns (bool);
        function transferFrom(address from, address to, uint256 value) external returns (bool);
        function approve(address spender, uint256 value) external returns (bool);
        function token0() external view returns (address);
        function token1() external view returns (address);
        function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    }
    
    interface IERC20 {
        function transfer(address to, uint256 amount) external returns (bool);
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

/**
 * @title QuickSwapAdapter
 * @notice Adapter for QuickSwap liquidity farming on Polygon
 * @dev Handles LP token interactions and QUICK rewards
 */
contract QuickSwapAdapter is IYieldProtocol {
    // State variables
    IQuickSwapRouter public immutable quickSwapRouter;
    IStakingRewards public immutable stakingRewards;
    ILPToken public immutable lpToken;
    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;
    IERC20 public immutable quickToken;
    IERC20 public immutable dQUICKToken; // Dual rewards token
    
    address public crossChainYield;
    string public protocolName;
    uint256 public totalDeposited;
    uint256 public slippageTolerance = 300; // 3% in basis points
    bool public dualRewardsEnabled;
    
    mapping(address => UserPosition) private userPositions;
    mapping(address => bool) public authorizedCallers;
    
    // Events
    event LiquidityAdded(address indexed user, uint256 amountA, uint256 amountB, uint256 liquidity);
    event LiquidityRemoved(address indexed user, uint256 amountA, uint256 amountB, uint256 liquidity);
    event RewardsStaked(address indexed user, uint256 lpAmount);
    event RewardsUnstaked(address indexed user, uint256 lpAmount);
    event RewardsHarvested(address indexed user, uint256 quickAmount, uint256 dQuickAmount);
    event CompoundedRewards(address indexed user, uint256 rewardsAmount, uint256 newLiquidity);
    
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
     * @param _quickSwapRouter QuickSwap router address
     * @param _stakingRewards Staking rewards contract address
     * @param _lpToken LP token address
     * @param _quickToken QUICK token address
     * @param _dQUICKToken dQUICK token address (for dual rewards)
     * @param _crossChainYield CrossChainYield contract address
     * @param _protocolName Human readable protocol name
     */
    constructor(
        address _quickSwapRouter,
        address _stakingRewards,
        address _lpToken,
        address _quickToken,
        address _dQUICKToken,
        address _crossChainYield,
        string memory _protocolName
    ) {
        require(_quickSwapRouter != address(0), "Invalid router address");
        require(_stakingRewards != address(0), "Invalid staking rewards address");
        require(_lpToken != address(0), "Invalid LP token address");
        require(_crossChainYield != address(0), "Invalid CrossChainYield address");
        
        quickSwapRouter = IQuickSwapRouter(_quickSwapRouter);
        stakingRewards = IStakingRewards(_stakingRewards);
        lpToken = ILPToken(_lpToken);
        quickToken = IERC20(_quickToken);
        dQUICKToken = IERC20(_dQUICKToken);
        
        tokenA = IERC20(ILPToken(_lpToken).token0());
        tokenB = IERC20(ILPToken(_lpToken).token1());
        
        crossChainYield = _crossChainYield;
        protocolName = _protocolName;
        dualRewardsEnabled = _dQUICKToken != address(0);
        
        // Set initial authorization
        authorizedCallers[_crossChainYield] = true;
        
        // Approve router and staking contract to spend tokens
        tokenA.approve(_quickSwapRouter, type(uint256).max);
        tokenB.approve(_quickSwapRouter, type(uint256).max);
        lpToken.approve(address(stakingRewards), type(uint256).max);
        quickToken.approve(_quickSwapRouter, type(uint256).max);
    }
    
    /**
     * @notice Deposit tokens and add liquidity to QuickSwap
     * @param user User address
     * @param amount Amount of underlying tokens to deposit (represents tokenA amount)
     * @return shares Amount of LP tokens received
     */
    function deposit(address user, uint256 amount) external override onlyAuthorized validUser(user) returns (uint256 shares) {
        require(amount > 0, "Deposit amount must be greater than 0");
        
        // For simplicity, assume equal value split between tokenA and tokenB
        uint256 amountA = amount / 2;
        uint256 amountB = amount / 2;
        
        // Transfer tokens from caller
        require(tokenA.transferFrom(msg.sender, address(this), amountA), "TokenA transfer failed");
        require(tokenB.transferFrom(msg.sender, address(this), amountB), "TokenB transfer failed");
        
        // Update user yield before deposit
        _updateUserYield(user);
        
        // Add liquidity to QuickSwap
        uint256 deadline = block.timestamp + 300; // 5 minutes
        uint256 amountAMin = (amountA * (10000 - slippageTolerance)) / 10000;
        uint256 amountBMin = (amountB * (10000 - slippageTolerance)) / 10000;
        
        (uint256 actualAmountA, uint256 actualAmountB, uint256 liquidity) = quickSwapRouter.addLiquidity(
            address(tokenA),
            address(tokenB),
            amountA,
            amountB,
            amountAMin,
            amountBMin,
            address(this),
            deadline
        );
        
        // Stake LP tokens in staking rewards contract
        stakingRewards.stake(liquidity);
        
        // Update user position
        UserPosition storage position = userPositions[user];
        if (!position.isActive) {
            position.isActive = true;
            position.lastUpdateTime = block.timestamp;
        }
        
        position.principal += (actualAmountA + actualAmountB);
        position.shares += liquidity;
        totalDeposited += (actualAmountA + actualAmountB);
        
        emit LiquidityAdded(user, actualAmountA, actualAmountB, liquidity);
        emit RewardsStaked(user, liquidity);
        emit Deposit(user, actualAmountA + actualAmountB, liquidity);
        
        return liquidity;
    }
    
    /**
     * @notice Withdraw liquidity and unstake from QuickSwap
     * @param user User address
     * @param shares Amount of LP tokens to withdraw (0 for all)
     * @return amount Total amount of underlying tokens received
     */
    function withdraw(address user, uint256 shares) external override onlyAuthorized validUser(user) returns (uint256 amount) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        // Update user yield before withdrawal
        _updateUserYield(user);
        
        uint256 sharesToWithdraw = shares == 0 ? position.shares : shares;
        require(sharesToWithdraw <= position.shares, "Insufficient shares");
        require(sharesToWithdraw > 0, "Shares must be greater than 0");
        
        // Unstake LP tokens from staking rewards (this also harvests pending rewards)
        stakingRewards.withdraw(sharesToWithdraw);
        
        // Remove liquidity from QuickSwap
        uint256 deadline = block.timestamp + 300; // 5 minutes
        (uint256 amountA, uint256 amountB) = quickSwapRouter.removeLiquidity(
            address(tokenA),
            address(tokenB),
            sharesToWithdraw,
            0, // Accept any amount of tokens out
            0, // Accept any amount of tokens out
            user,
            deadline
        );
        
        uint256 totalAmount = amountA + amountB;
        
        // Update user position
        position.shares -= sharesToWithdraw;
        if (shares == 0 || position.shares == 0) {
            // Full withdrawal
            position.principal = 0;
            position.accruedYield = 0;
            position.isActive = false;
        } else {
            // Partial withdrawal - reduce principal proportionally
            uint256 principalReduction = (position.principal * sharesToWithdraw) / (position.shares + sharesToWithdraw);
            position.principal -= principalReduction;
        }
        
        totalDeposited -= (totalAmount > totalDeposited ? totalDeposited : totalAmount);
        
        emit LiquidityRemoved(user, amountA, amountB, sharesToWithdraw);
        emit RewardsUnstaked(user, sharesToWithdraw);
        emit Withdraw(user, totalAmount, sharesToWithdraw);
        
        return totalAmount;
    }
    
    /**
     * @notice Harvest QUICK rewards for a user
     * @param user User address
     * @return yieldAmount Amount of QUICK rewards harvested
     */
    function harvestYield(address user) external override onlyAuthorized validUser(user) returns (uint256 yieldAmount) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        // Get pending rewards
        uint256 earnedRewards = stakingRewards.earned(address(this));
        
        if (earnedRewards > 0) {
            // Claim rewards
            stakingRewards.getReward();
            
            // Transfer QUICK rewards to user
            uint256 quickBalance = quickToken.balanceOf(address(this));
            uint256 dQuickBalance = 0;
            
            if (dualRewardsEnabled) {
                dQuickBalance = dQUICKToken.balanceOf(address(this));
                if (dQuickBalance > 0) {
                    dQUICKToken.transfer(user, dQuickBalance);
                }
            }
            
            if (quickBalance > 0) {
                quickToken.transfer(user, quickBalance);
                yieldAmount = quickBalance;
            }
            
            emit RewardsHarvested(user, quickBalance, dQuickBalance);
        }
        
        // Update user position
        position.accruedYield = 0;
        position.lastUpdateTime = block.timestamp;
        
        emit YieldHarvested(user, yieldAmount);
        
        return yieldAmount;
    }
    
    /**
     * @notice Compound QUICK rewards by adding to liquidity
     * @param user User address
     * @return newShares New LP tokens received from compounding
     */
    function compound(address user) external override onlyAuthorized validUser(user) returns (uint256 newShares) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        // Get pending rewards
        uint256 earnedRewards = stakingRewards.earned(address(this));
        
        if (earnedRewards > 0) {
            // Claim rewards
            stakingRewards.getReward();
            
            uint256 quickBalance = quickToken.balanceOf(address(this));
            
            if (quickBalance > 0) {
                // Convert QUICK to tokenA and tokenB
                uint256 halfQuick = quickBalance / 2;
                
                // Swap QUICK to tokenA
                address[] memory pathA = new address[](2);
                pathA[0] = address(quickToken);
                pathA[1] = address(tokenA);
                
                uint256[] memory amountsOutA = quickSwapRouter.getAmountsOut(halfQuick, pathA);
                uint256 amountOutMinA = (amountsOutA[1] * (10000 - slippageTolerance)) / 10000;
                
                uint256[] memory actualAmountsA = quickSwapRouter.swapExactTokensForTokens(
                    halfQuick,
                    amountOutMinA,
                    pathA,
                    address(this),
                    block.timestamp + 300
                );
                
                // Swap QUICK to tokenB
                address[] memory pathB = new address[](2);
                pathB[0] = address(quickToken);
                pathB[1] = address(tokenB);
                
                uint256[] memory amountsOutB = quickSwapRouter.getAmountsOut(halfQuick, pathB);
                uint256 amountOutMinB = (amountsOutB[1] * (10000 - slippageTolerance)) / 10000;
                
                uint256[] memory actualAmountsB = quickSwapRouter.swapExactTokensForTokens(
                    halfQuick,
                    amountOutMinB,
                    pathB,
                    address(this),
                    block.timestamp + 300
                );
                
                // Add liquidity with the swapped tokens
                uint256 deadline = block.timestamp + 300;
                (,, uint256 liquidity) = quickSwapRouter.addLiquidity(
                    address(tokenA),
                    address(tokenB),
                    actualAmountsA[1],
                    actualAmountsB[1],
                    (actualAmountsA[1] * (10000 - slippageTolerance)) / 10000,
                    (actualAmountsB[1] * (10000 - slippageTolerance)) / 10000,
                    address(this),
                    deadline
                );
                
                // Stake the new LP tokens
                stakingRewards.stake(liquidity);
                
                // Update user position
                position.shares += liquidity;
                position.principal += (actualAmountsA[1] + actualAmountsB[1]);
                totalDeposited += (actualAmountsA[1] + actualAmountsB[1]);
                
                newShares = liquidity;
                
                emit CompoundedRewards(user, quickBalance, liquidity);
            }
        }
        
        position.lastUpdateTime = block.timestamp;
        
        return newShares;
    }
    
    /**
     * @notice Update user's accrued yield (QUICK rewards)
     * @param user User address
     */
    function _updateUserYield(address user) internal {
        UserPosition storage position = userPositions[user];
        
        if (!position.isActive || position.shares == 0) {
            return;
        }
        
        // Get earned rewards as yield
        uint256 earnedRewards = stakingRewards.earned(address(this));
        position.accruedYield = earnedRewards;
        position.lastUpdateTime = block.timestamp;
    }
    
    // View functions
    function getProtocolInfo() external view override returns (ProtocolInfo memory) {
        return ProtocolInfo({
            name: protocolName,
            protocolAddress: address(stakingRewards),
            underlyingToken: address(lpToken),
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
            return 0;
        }
        
        return stakingRewards.earned(address(this));
    }
    
    function getCurrentAPY() public view override returns (uint256) {
        // Calculate APY based on reward rate and total supply
        uint256 rewardRate = stakingRewards.rewardRate();
        uint256 totalSupplyValue = stakingRewards.totalSupply();
        
        if (totalSupplyValue == 0) return 0;
        
        // Simplified APY calculation
        // APY = (rewardRate * 365 days * 100) / totalSupply
        uint256 annualRewards = rewardRate * 365 days;
        return (annualRewards * 10000) / totalSupplyValue; // Return in basis points
    }
    
    function getTotalValueLocked() external view override returns (uint256) {
        return totalDeposited;
    }
    
    function getSharePrice() external view override returns (uint256) {
        uint256 totalSupplyLP = lpToken.totalSupply();
        if (totalSupplyLP == 0) return 1e18;
        
        (uint112 reserve0, uint112 reserve1,) = lpToken.getReserves();
        uint256 totalValue = uint256(reserve0) + uint256(reserve1);
        
        return (totalValue * 1e18) / totalSupplyLP;
    }
    
    function balanceOf(address user) external view override returns (uint256) {
        return userPositions[user].shares;
    }
    
    function totalSupply() external view override returns (uint256) {
        return stakingRewards.balanceOf(address(this));
    }
    
    // Admin functions
    function updateAPY() external override returns (uint256 newAPY) {
        // APY is calculated based on current reward rates
        return getCurrentAPY();
    }
    
    function emergencyWithdraw(address user) external override onlyAuthorized returns (uint256 amount) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        uint256 stakedBalance = stakingRewards.balanceOf(address(this));
        
        // Emergency exit from staking (loses pending rewards)
        stakingRewards.exit();
        
        uint256 lpBalance = lpToken.balanceOf(address(this));
        
        // Remove liquidity
        uint256 deadline = block.timestamp + 300;
        (uint256 amountA, uint256 amountB) = quickSwapRouter.removeLiquidity(
            address(tokenA),
            address(tokenB),
            lpBalance,
            0,
            0,
            user,
            deadline
        );
        
        uint256 totalAmount = amountA + amountB;
        
        // Reset user position
        position.principal = 0;
        position.shares = 0;
        position.accruedYield = 0;
        position.isActive = false;
        
        return totalAmount;
    }
    
    function setProtocolStatus(bool isActive) external override {
        // Implementation depends on access control requirements
    }
    
    // Configuration functions
    function setSlippageTolerance(uint256 newSlippage) external {
        require(msg.sender == crossChainYield, "Only CrossChainYield can set slippage");
        require(newSlippage <= 1000, "Slippage too high"); // Max 10%
        slippageTolerance = newSlippage;
    }
    
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
    
    // Helper functions
    function getEarnedRewards() external view returns (uint256) {
        return stakingRewards.earned(address(this));
    }
    
    function getRewardRate() external view returns (uint256) {
        return stakingRewards.rewardRate();
    }
    
    function getStakingBalance() external view returns (uint256) {
        return stakingRewards.balanceOf(address(this));
    }
    
    function isDualRewardsEnabled() external view returns (bool) {
        return dualRewardsEnabled;
    }
}