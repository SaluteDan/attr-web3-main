// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./Errors.sol";

/**
 * @title MembershipSaleSplitter
 * @dev Immutable 70/30 ETH splitter for membership sale proceeds.
 *      On every ETH receipt, 70% is forwarded to `treasuryOps` and
 *      30% is forwarded to `liquidityReceiver` (used to seed ATTR/WETH LP).
 *
 *      There is no owner and no mutable state — the split is enforced by
 *      the constructor arguments and cannot be changed after deployment.
 *      Point `MembershipToken.paymentReceiver` to this contract address.
 */
contract MembershipSaleSplitter {

    /// @notice Treasury operations wallet (receives 70% of every sale).
    address public immutable treasuryOps;

    /// @notice Liquidity bootstrapping wallet (receives 30% of every sale).
    address public immutable liquidityReceiver;

    // ── Events ─────────────────────────────────────────────────────────────────

    event SaleSplit(
        address indexed sender,
        uint256 treasuryAmount,
        uint256 liquidityAmount
    );

    // ── Constructor ────────────────────────────────────────────────────────────

    /**
     * @param treasuryOps_       70% recipient — treasury operations wallet.
     * @param liquidityReceiver_ 30% recipient — LP capital wallet.
     */
    constructor(address treasuryOps_, address liquidityReceiver_) {
        if (treasuryOps_ == address(0)) revert ZeroAddress();
        if (liquidityReceiver_ == address(0)) revert ZeroAddress();
        treasuryOps = treasuryOps_;
        liquidityReceiver = liquidityReceiver_;
    }

    // ── Receive ────────────────────────────────────────────────────────────────

    /**
     * @dev Automatically splits every incoming ETH payment 70/30.
     *      Integer division truncates — the 1-wei dust is kept by the treasury
     *      (treasuryAmount = msg.value - liquidityAmount).
     */
    receive() external payable {
        if (msg.value == 0) return;

        uint256 liquidityAmount = (msg.value * 30) / 100;
        uint256 treasuryAmount = msg.value - liquidityAmount;

        (bool okTreasury, ) = treasuryOps.call{value: treasuryAmount}("");
        if (!okTreasury) revert TransferFailed();

        (bool okLiquidity, ) = liquidityReceiver.call{value: liquidityAmount}("");
        if (!okLiquidity) revert TransferFailed();

        emit SaleSplit(msg.sender, treasuryAmount, liquidityAmount);
    }
}
