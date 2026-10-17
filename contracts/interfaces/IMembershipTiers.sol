// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IMembershipTiers
/// @notice Minimal tier surface the distributor binds to. Tier is read from the
///         membership contract at claim/read time; it is never caller-supplied.
interface IMembershipTiers {
    /// @notice Tier of an existing membership (1 or 2); MUST revert if unminted.
    function getTier(uint256 tokenId) external view returns (uint256);

    /// @notice Lifetime minted supply (max extant token id + 1).
    function totalSupply() external view returns (uint256);
}
