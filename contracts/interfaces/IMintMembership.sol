// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IMintMembership
/// @notice Minimal interface for the public mint entry point of MembershipToken.
interface IMintMembership {
    /// @notice Mint a membership NFT for a given tier, paying the tier price.
    /// @param tier The membership tier to mint.
    /// @param metadataURI The token metadata URI.
    /// @return tokenId The minted token ID.
    function mintMembership(uint256 tier, string memory metadataURI) external payable returns (uint256);
}
