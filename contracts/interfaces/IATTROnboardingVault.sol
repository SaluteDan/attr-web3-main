// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IATTROnboardingVault
/// @notice Minimal interface for the autonomous onboarding-grant escrow vault.
interface IATTROnboardingVault {
    /// @notice Disburse a welcome grant of ATTR to a new membership holder.
    /// @dev Callable only by the configured MembershipToken.
    /// @param recipient The grant recipient.
    /// @param amount The ATTR amount to transfer.
    function disburseGrant(address recipient, uint256 amount) external;
}
