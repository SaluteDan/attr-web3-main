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

/**
 * @title ReentrantMintRecipient
 * @author ATTR Dev
 * @notice Test-only malicious ERC-721 recipient.
 * @dev On receiving a token via `_safeMint`, it re-enters the target collection's
 *      PUBLIC `mintMembership`, consuming an extra unit of the shared token capacity.
 *
 *      This models the attack proven in the PR #8 security verdict: a contract
 *      recipient included in `adminBatchMintMemberships` gets an
 *      `onERC721Received` callback mid-loop and can advance `_nextTokenId`,
 *      bypassing the batch's up-front-only MAX_SUPPLY check.
 *
 *      A one-shot flag prevents unbounded recursion: after a single re-entry the
 *      callback succeeds without further re-entry.
 */
contract ReentrantMintRecipient {
    /// @notice Collection whose public mint is re-entered.
    address public immutable TARGET;
    /// @notice Tier used for the re-entrant mint.
    uint256 public immutable TIER;
    /// @notice Tier price forwarded to the re-entrant mint.
    uint256 public immutable PRICE;

    bool private _reentered;

    /// @param target_ Collection whose public mint is re-entered.
    /// @param tier_ Tier used for the re-entrant mint.
    /// @param price_ Tier price forwarded to the re-entrant mint.
    constructor(address target_, uint256 tier_, uint256 price_) {
        TARGET = target_;
        TIER = tier_;
        PRICE = price_;
    }

    /// @notice Payable entry point so the mock can be prefunded for the re-entrant mint.
    receive() external payable {}

    /// @notice ERC-721 receiver hook; re-enters the public mint once.
    /// @return The ERC-721 receiver selector.
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external returns (bytes4) {
        if (!_reentered) {
            _reentered = true;
            IMintMembership(TARGET).mintMembership{value: PRICE}(TIER, "ipfs://reentrant");
        }
        return this.onERC721Received.selector;
    }
}
