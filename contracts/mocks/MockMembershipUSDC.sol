// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title MockMembershipUSDC
/// @notice Six-decimal EIP-2612 token for local membership checkout tests.
contract MockMembershipUSDC is ERC20Permit {
    constructor() ERC20("USD Coin", "USDC") ERC20Permit("USD Coin") {}

    /// @notice Match native USDC precision.
    function decimals() public pure override returns (uint8) { return 6; }

    /// @notice Fund test wallets; never deploy this mock in production.
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
