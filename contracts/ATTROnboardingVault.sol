// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./Errors.sol";

/**
 * @title ATTROnboardingVault
 * @author Attributes Gallery
 * @notice Autonomous escrow holding the 150,000,000 ATTR membership welcome-grant pool.
 * @dev Only the configured `MembershipToken` may pull grants via `disburseGrant`, eliminating
 *      off-chain allowance revocations and wallet-drain approvals. Ownership sits with the DAO
 *      Timelock/Multisig, which retains an `emergencyRescue` path.
 *
 *      Non-exhaustion invariant: the membership collection is hard-capped at 50,000 NFTs and the
 *      largest grant is 2,500 ATTR, so the worst-case lifetime disbursement is 125,000,000 ATTR —
 *      strictly below the 150,000,000 ATTR initial funding.
 */
contract ATTROnboardingVault is Ownable {
    using SafeERC20 for IERC20;

    /// @notice The ATTR token disbursed by this vault.
    IERC20 public immutable attrToken;

    /// @notice The MembershipToken authorized to pull grants. Settable once by the owner.
    address public membershipToken;

    // ── Events ─────────────────────────────────────────────────────────────────

    event MembershipTokenUpdated(address indexed membershipToken);
    event GrantDisbursed(address indexed recipient, uint256 amount, uint256 remainingBalance);
    event EmergencyRescued(address indexed to, uint256 amount);

    // ── Constructor ────────────────────────────────────────────────────────────

    /**
     * @param attrToken_        The ATTR token held and disbursed by the vault (non-zero).
     * @param membershipToken_  The MembershipToken allowed to pull grants (may be zero at deploy).
     * @param daoTimelock_      The DAO Timelock/Multisig that owns the vault (non-zero).
     */
    constructor(address attrToken_, address membershipToken_, address daoTimelock_)
        Ownable(daoTimelock_)
    {
        if (attrToken_ == address(0) || membershipToken_ == address(0) || daoTimelock_ == address(0)) {
            revert ZeroAddress();
        }
        attrToken = IERC20(attrToken_);
        membershipToken = membershipToken_;
    }

    // ── Governance configuration ───────────────────────────────────────────────

    /// @notice Bind (or re-bind) the MembershipToken allowed to pull grants. Owner only.
    function setMembershipToken(address membershipToken_) external onlyOwner {
        if (membershipToken_ == address(0)) revert ZeroAddress();
        membershipToken = membershipToken_;
        emit MembershipTokenUpdated(membershipToken_);
    }

    // ── Disbursement ───────────────────────────────────────────────────────────

    /**
     * @notice Disburse a welcome grant of ATTR to a new membership holder.
     * @dev Restricted to the configured MembershipToken. Reverts if the recipient is the zero
     *      address or the vault cannot cover the amount.
     * @param recipient The grant recipient.
     * @param amount The ATTR amount to transfer.
     */
    function disburseGrant(address recipient, uint256 amount) external {
        if (msg.sender != membershipToken) revert Unauthorized();
        if (recipient == address(0)) revert ZeroAddress();

        uint256 balance = attrToken.balanceOf(address(this));
        if (balance < amount) revert InsufficientVaultBalance();

        attrToken.safeTransfer(recipient, amount);
        emit GrantDisbursed(recipient, amount, balance - amount);
    }

    // ── Emergency / migration rescue ───────────────────────────────────────────

    /// @notice Rescue ATTR held by the vault. Callable only by the DAO Timelock/Multisig (owner).
    function emergencyRescue(address to, uint256 amount) external onlyOwner {
        attrToken.safeTransfer(to, amount);
        emit EmergencyRescued(to, amount);
    }
}
