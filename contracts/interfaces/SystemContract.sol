// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title SystemContract Interface
 * @notice Interface for ZetaChain system contract functionality
 */
interface ISystemContract {
    struct zContext {
        bytes origin;
        address sender;
        uint256 chainID;
    }
    
    function wZetaContractAddress() external view returns (address);
    function gasZetaPoolByChainId(uint256 chainId) external view returns (address);
    function gasCoinZRC20ByChainId(uint256 chainId) external view returns (address);
    function gasTokenByChainId(uint256 chainId) external view returns (address);
    function uniswapv2FactoryAddress() external view returns (address);
    function uniswapv2Router02Address() external view returns (address);
}

contract SystemContract {
    mapping(uint256 => address) private _gasTokenByChainId;
    mapping(uint256 => address) private _gasCoinZRC20ByChainId;
    address private _wZetaContractAddress;
    address private _uniswapv2FactoryAddress;
    address private _uniswapv2Router02Address;
    
    constructor() {
        _wZetaContractAddress = address(0x1234567890123456789012345678901234567890);
        _uniswapv2FactoryAddress = address(0x2345678901234567890123456789012345678901);
        _uniswapv2Router02Address = address(0x3456789012345678901234567890123456789012);
    }
    
    function wZetaContractAddress() external view returns (address) {
        return _wZetaContractAddress;
    }
    
    function gasZetaPoolByChainId(uint256 chainId) external view returns (address) {
        return _gasTokenByChainId[chainId];
    }
    
    function gasCoinZRC20ByChainId(uint256 chainId) external view returns (address) {
        return _gasCoinZRC20ByChainId[chainId];
    }
    
    function gasTokenByChainId(uint256 chainId) external view returns (address) {
        return _gasTokenByChainId[chainId];
    }
    
    function uniswapv2FactoryAddress() external view returns (address) {
        return _uniswapv2FactoryAddress;
    }
    
    function uniswapv2Router02Address() external view returns (address) {
        return _uniswapv2Router02Address;
    }
    
    function setGasTokenByChainId(uint256 chainId, address tokenAddress) external {
        _gasTokenByChainId[chainId] = tokenAddress;
    }
    
    function setGasCoinZRC20ByChainId(uint256 chainId, address tokenAddress) external {
        _gasCoinZRC20ByChainId[chainId] = tokenAddress;
    }
}