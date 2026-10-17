// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IMembershipFeeDistributor
/// @notice Minimal transfer-hook surface the membership ERC-721 calls into on
///         every transfer where `from != to`.
///
/// @dev Settlement semantics (settled business rule F-1):
///      On transfer the distributor MUST settle the *outgoing* holder's accrual
///      for the elapsed sub-interval (using the frozen `intervalWeight`
///      denominator recorded at deposit) and credit it to that holder's own
///      `pendingClaims` balance, then reset the token's accrual clock so the
///      incoming holder accrues **only** from the transfer timestamp.
///
///      This defeats snapshot rental (F1): value binds to genuine holding time,
///      never to `now - lastDeposit` paid to whoever owns the token at claim.
interface IMembershipFeeDistributor {
    /// @notice Notify the distributor of a membership transfer.
    /// @dev Must be callable ONLY by the registered membership token. A
    ///      checkpoint from any other caller MUST revert (`Unauthorized`).
    /// @param tokenId The membership token id being transferred.
    /// @param from    Previous holder (accrual settled into their pending balance).
    /// @param to      New holder (accrual clock reset to `block.timestamp`).
    function checkpoint(uint256 tokenId, address from, address to) external;
}
