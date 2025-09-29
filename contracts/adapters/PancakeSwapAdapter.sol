// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../interfaces/IYieldProtocol.sol";

// PancakeSwap interfaces
interface IPancakeRouter {
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
        
        function getAmountsOut(uint256 amountIn, address[] calldata path)
            external view returns (uint256[] memory amounts);
    }
    
    interface IMasterChef {
        function deposit(uint256 _pid, uint256 _amount) external;
        function withdraw(uint256 _pid, uint256 _amount) external;
        function emergencyWithdraw(uint256 _pid) external;
        function pendingCake(uint256 _pid, address _user) external view returns (uint256);
        function userInfo(uint256 _pid, address _user) external view returns (uint256 amount, uint256 rewardDebt);
        function poolInfo(uint256 _pid) external view returns (
            address lpToken,
            uint256 allocPoint,
            uint256 lastRewardBlock,
            uint256 accCakePerShare
        );
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
 * @title PancakeSwapAdapter
 * @notice Adapter for PancakeSwap liquidity farming and staking
 * @dev Handles LP token interactions and CAKE rewards
 */
contract PancakeSwapAdapter is IYieldProtocol {
    // State variables
    IPancakeRouter public immutable pancakeRouter;
    IMasterChef public immutable masterChef;
    ILPToken public immutable lpToken;
    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;
    IERC20 public immutable cakeToken;
    
    address public crossChainYield;
    string public protocolName;
    uint256 public poolId;
    uint256 public totalDeposited;
    uint256 public slippageTolerance = 300; // 3% in basis points
    
    mapping(address => UserPosition) private userPositions;
    mapping(address => bool) public authorizedCallers;
    
    // Events
    event LiquidityAdded(address indexed user, uint256 amountA, uint256 amountB, uint256 liquidity);
    event LiquidityRemoved(address indexed user, uint256 amountA, uint256 amountB, uint256 liquidity);
    event FarmsStaked(address indexed user, uint256 lpAmount);
    event FarmsUnstaked(address indexed user, uint256 lpAmount);
    event CakeHarvested(address indexed user, uint256 cakeAmount);
    event CompoundedRewards(address indexed user, uint256 cakeAmount, uint256 newLiquidity);
    
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
     * @param _pancakeRouter PancakeSwap router address
     * @param _masterChef MasterChef contract address
     * @param _lpToken LP token address
     * @param _cakeToken CAKE token address
     * @param _poolId Pool ID in MasterChef
     * @param _crossChainYield CrossChainYield contract address
     * @param _protocolName Human readable protocol name
     */
    constructor(
        address _pancakeRouter,
        address _masterChef,
        address _lpToken,
        address _cakeToken,
        uint256 _poolId,
        address _crossChainYield,
        string memory _protocolName
    ) {
        require(_pancakeRouter != address(0), "Invalid router address");
        require(_masterChef != address(0), "Invalid MasterChef address");
        require(_lpToken != address(0), "Invalid LP token address");
        require(_crossChainYield != address(0), "Invalid CrossChainYield address");
        
        pancakeRouter = IPancakeRouter(_pancakeRouter);
        masterChef = IMasterChef(_masterChef);
        lpToken = ILPToken(_lpToken);
        cakeToken = IERC20(_cakeToken);
        
        tokenA = IERC20(ILPToken(_lpToken).token0());
        tokenB = IERC20(ILPToken(_lpToken).token1());
        
        poolId = _poolId;
        crossChainYield = _crossChainYield;
        protocolName = _protocolName;
        
        // Set initial authorization
        authorizedCallers[_crossChainYield] = true;
        
        // Approve router and masterchef to spend tokens
        tokenA.approve(_pancakeRouter, type(uint256).max);
        tokenB.approve(_pancakeRouter, type(uint256).max);
        lpToken.approve(_masterChef, type(uint256).max);
        cakeToken.approve(_pancakeRouter, type(uint256).max);
    }
    
    /**
     * @notice Deposit tokens and add liquidity to PancakeSwap
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
        
        // Add liquidity to PancakeSwap
        uint256 deadline = block.timestamp + 300; // 5 minutes
        uint256 amountAMin = (amountA * (10000 - slippageTolerance)) / 10000;
        uint256 amountBMin = (amountB * (10000 - slippageTolerance)) / 10000;
        
        (uint256 actualAmountA, uint256 actualAmountB, uint256 liquidity) = pancakeRouter.addLiquidity(
            address(tokenA),
            address(tokenB),
            amountA,
            amountB,
            amountAMin,
            amountBMin,
            address(this),
            deadline
        );
        
        // Stake LP tokens in MasterChef
        masterChef.deposit(poolId, liquidity);
        
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
        emit FarmsStaked(user, liquidity);
        emit Deposit(user, actualAmountA + actualAmountB, liquidity);
        
        return liquidity;
    }
    
    /**
     * @notice Withdraw liquidity and unstake from PancakeSwap
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
        
        // Unstake LP tokens from MasterChef (this also harvests pending CAKE)
        masterChef.withdraw(poolId, sharesToWithdraw);
        
        // Remove liquidity from PancakeSwap
        uint256 deadline = block.timestamp + 300; // 5 minutes
        (uint256 amountA, uint256 amountB) = pancakeRouter.removeLiquidity(
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
        emit FarmsUnstaked(user, sharesToWithdraw);
        emit Withdraw(user, totalAmount, sharesToWithdraw);
        
        return totalAmount;
    }
    
    /**
     * @notice Harvest CAKE rewards for a user
     * @param user User address
     * @return yieldAmount Amount of CAKE rewards harvested
     */
    function harvestYield(address user) external override onlyAuthorized validUser(user) returns (uint256 yieldAmount) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        // Get pending CAKE rewards
        uint256 pendingCakeAmount = masterChef.pendingCake(poolId, address(this));
        
        if (pendingCakeAmount > 0) {
            // Withdraw 0 LP tokens to trigger CAKE harvest
            masterChef.withdraw(poolId, 0);
            
            // Transfer CAKE rewards to user
            uint256 cakeBalance = cakeToken.balanceOf(address(this));
            if (cakeBalance > 0) {
                cakeToken.transfer(user, cakeBalance);
                yieldAmount = cakeBalance;
            }
        }
        
        // Update user position
        position.accruedYield = 0;
        position.lastUpdateTime = block.timestamp;
        
        emit CakeHarvested(user, yieldAmount);
        emit YieldHarvested(user, yieldAmount);
        
        return yieldAmount;
    }
    
    /**
     * @notice Compound CAKE rewards by adding to liquidity
     * @param user User address
     * @return newShares New LP tokens received from compounding
     */
    function compound(address user) external override onlyAuthorized validUser(user) returns (uint256 newShares) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        // Harvest CAKE rewards first
        uint256 pendingCakeAmount = masterChef.pendingCake(poolId, address(this));
        
        if (pendingCakeAmount > 0) {
            // Withdraw 0 LP tokens to trigger CAKE harvest
            masterChef.withdraw(poolId, 0);
            
            uint256 cakeBalance = cakeToken.balanceOf(address(this));
            
            if (cakeBalance > 0) {
                // Convert half of CAKE to tokenA and half to tokenB
                uint256 halfCake = cakeBalance / 2;
                
                // Swap CAKE to tokenA
                address[] memory pathA = new address[](2);
                pathA[0] = address(cakeToken);
                pathA[1] = address(tokenA);
                
                uint256[] memory amountsOutA = pancakeRouter.getAmountsOut(halfCake, pathA);
                uint256 expectedTokenA = amountsOutA[1];
                
                // Swap CAKE to tokenB
                address[] memory pathB = new address[](2);
                pathB[0] = address(cakeToken);
                pathB[1] = address(tokenB);
                
                uint256[] memory amountsOutB = pancakeRouter.getAmountsOut(halfCake, pathB);
                uint256 expectedTokenB = amountsOutB[1];
                
                // Note: Actual swap implementation would require swap functions
                // This is simplified for demonstration
                
                // Add liquidity with the swapped tokens
                uint256 deadline = block.timestamp + 300;
                (,, uint256 liquidity) = pancakeRouter.addLiquidity(
                    address(tokenA),
                    address(tokenB),
                    expectedTokenA,
                    expectedTokenB,
                    (expectedTokenA * (10000 - slippageTolerance)) / 10000,
                    (expectedTokenB * (10000 - slippageTolerance)) / 10000,
                    address(this),
                    deadline
                );
                
                // Stake the new LP tokens
                masterChef.deposit(poolId, liquidity);
                
                // Update user position
                position.shares += liquidity;
                position.principal += (expectedTokenA + expectedTokenB);
                totalDeposited += (expectedTokenA + expectedTokenB);
                
                newShares = liquidity;
                
                emit CompoundedRewards(user, cakeBalance, liquidity);
            }
        }
        
        position.lastUpdateTime = block.timestamp;
        
        return newShares;
    }
    
    /**
     * @notice Update user's accrued yield (CAKE rewards)
     * @param user User address
     */
    function _updateUserYield(address user) internal {
        UserPosition storage position = userPositions[user];
        
        if (!position.isActive || position.shares == 0) {
            return;
        }
        
        // Get pending CAKE rewards as yield
        uint256 pendingCakeAmount = masterChef.pendingCake(poolId, address(this));
        position.accruedYield = pendingCakeAmount;
        position.lastUpdateTime = block.timestamp;
    }
    
    // View functions
    function getProtocolInfo() external view override returns (ProtocolInfo memory) {
        return ProtocolInfo({
            name: protocolName,
            protocolAddress: address(masterChef),
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
        
        return masterChef.pendingCake(poolId, address(this));
    }
    
    function getCurrentAPY() public view override returns (uint256) {
        // Simplified APY calculation based on CAKE rewards
        // Real implementation would consider pool allocation points, CAKE per block, etc.
        return 1500; // 15% APY in basis points (example)
    }
    
    function getTotalValueLocked() external view override returns (uint256) {
        return totalDeposited;
    }
    
    function getSharePrice() external view override returns (uint256) {
        uint256 totalSupplyValue = lpToken.totalSupply();
        if (totalSupplyValue == 0) return 1e18;
        
        (uint112 reserve0, uint112 reserve1,) = lpToken.getReserves();
        uint256 totalValue = uint256(reserve0) + uint256(reserve1);
        
        return (totalValue * 1e18) / totalSupplyValue;
    }
    
    function balanceOf(address user) external view override returns (uint256) {
        return userPositions[user].shares;
    }
    
    function totalSupply() external view override returns (uint256) {
        (uint256 amount,) = masterChef.userInfo(poolId, address(this));
        return amount;
    }
    
    // Admin functions
    function updateAPY() external override returns (uint256 newAPY) {
        // APY is calculated based on current CAKE emission rates
        return getCurrentAPY();
    }
    
    function emergencyWithdraw(address user) external override onlyAuthorized returns (uint256 amount) {
        UserPosition storage position = userPositions[user];
        require(position.isActive, "No active position");
        
        // Emergency withdraw from MasterChef (loses pending rewards)
        masterChef.emergencyWithdraw(poolId);
        
        uint256 lpBalance = lpToken.balanceOf(address(this));
        
        // Remove liquidity
        uint256 deadline = block.timestamp + 300;
        (uint256 amountA, uint256 amountB) = pancakeRouter.removeLiquidity(
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
    function getPendingCake(address user) external view returns (uint256) {
        return masterChef.pendingCake(poolId, address(this));
    }
    
    function getPoolInfo() external view returns (
        address lpTokenAddress,
        uint256 allocPoint,
        uint256 lastRewardBlock,
        uint256 accCakePerShare
    ) {
        return masterChef.poolInfo(poolId);
    }
    
    function getUserInfo(address user) external view returns (uint256 amount, uint256 rewardDebt) {
        return masterChef.userInfo(poolId, address(this));
    }
}