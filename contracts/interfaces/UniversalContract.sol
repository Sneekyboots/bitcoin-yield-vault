// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title UniversalContract Interface
 * @notice Interface for ZetaChain Universal Contract functionality
 */

struct MessageContext {
    bytes origin;
    address sender;
    uint256 chainID;
}

struct RevertContext {
    bytes origin;
    address sender;
    uint256 chainID;
    address asset;
    uint256 amount;
    bytes revertMessage;
}

struct AbortContext {
    bytes origin;
    address sender;
    uint256 chainID;
    address asset;
    uint256 amount;
    bytes abortMessage;
}

interface zContract {
    function onCall(
        MessageContext calldata context,
        address zrc20,
        uint256 amount,
        bytes calldata message
    ) external;

    function onRevert(
        RevertContext calldata context,
        address zrc20,
        uint256 amount,
        bytes calldata message
    ) external;

    function onAbort(
        AbortContext calldata context,
        address zrc20,
        uint256 amount,
        bytes calldata message
    ) external;
}