// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MembershipFeeDistributor} from "../../../contracts/MembershipFeeDistributor.sol";
import {MockMembershipToken} from "../../../contracts/mocks/MockMembershipToken.sol";
import {MockFeeUSDC} from "../../../contracts/mocks/MockFeeTokens.sol";
import "../../../contracts/Errors.sol";

/// @notice ERC-721-receiver-capable ETH payee.
contract C1Actor {
    uint256 public received;
    receive() external payable {
        received += msg.value;
    }
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

/**
 * @title MembershipFeeDistributorC1Test
 * @notice Regression suite for the C-1 finding: a token MINTED mid-interval
 *         (after a deposit) must NOT capture value from intervals it was absent
 *         from. Two mechanisms enforce this:
 *           1. `_frozenWeight` returns 0 for a token absent from the deposit
 *              sweep, so it earns nothing from the currently open interval.
 *           2. `_freezeBasis` re-bases a newly enrolled token's debt to the
 *              closed-interval cumulative at enrollment, so it cannot claim
 *              PRIOR closed intervals either (the `cumReward` accumulator
 *              distributes by current weight, which would otherwise leak).
 *         Without both, `Σ entitlements > pool` and a later claim reverts.
 */
contract MembershipFeeDistributorC1Test is Test {
    MembershipFeeDistributor internal dist;
    MockMembershipToken internal membership;
    MockFeeUSDC internal usdc;

    address internal dao = address(0xDA0);
    C1Actor internal aliceC;
    C1Actor internal bobC;
    address internal alice;
    address internal bob;

    uint256 internal constant WINDOW = 1 days;
    uint256 internal constant D = 1_000 ether;

    function setUp() public {
        membership = new MockMembershipToken("ATTR-MEMBER-ID", "ATTR#");
        dist = new MembershipFeeDistributor(address(membership), dao);
        usdc = new MockFeeUSDC();
        membership.setFeeDistributor(address(dist));
        vm.deal(dao, 1_000_000 ether);
        aliceC = new C1Actor();
        bobC = new C1Actor();
        alice = address(aliceC);
        bob = address(bobC);
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
        vm.prank(dao);
        dist.setTotalMintedSnapshot(type(uint256).max);
        vm.warp(1_700_000_000);
    }

    function _one(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function _deposit(uint256 amount) internal {
        vm.prank(dao);
        dist.depositETH{value: amount}();
    }

    function _pool(uint256 amount, uint256 W) internal pure returns (uint256) {
        return amount - (amount % W);
    }

    // ── C-1 core: mid-interval mint must not over-commit the pool ──────────────

    function test_MintMidInterval_NoOverCommit_ETH() public {
        uint256 aliceId = membership.mint(alice, 1);
        _deposit(D); // pool sized to W = 225 (one T1)
        vm.warp(block.timestamp + WINDOW / 2);
        uint256 bobId = membership.mint(bob, 1); // MINTED mid-interval (the C-1 hole)
        vm.warp(block.timestamp + WINDOW / 2);

        uint256 pool = _pool(D, 225);

        // Alice (held the full interval) claims her full weighted share.
        vm.prank(alice);
        dist.claimETH(_one(aliceId));
        assertEq(aliceC.received(), pool, "original holder must get the full pool");

        // Bob (minted mid-interval) earns nothing from the closed interval.
        vm.prank(bob);
        vm.expectRevert(NothingToClaim.selector);
        dist.claimETH(_one(bobId));

        // Conservation: payouts never exceed the deposit.
        assertLe(aliceC.received(), D, "payout exceeded deposit");
        assertEq(address(dist).balance, D - pool, "only dust remains");
    }

    function test_MintMidInterval_ParticipatesNextInterval() public {
        uint256 aliceId = membership.mint(alice, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW / 2);
        uint256 bobId = membership.mint(bob, 1);
        vm.warp(block.timestamp + WINDOW / 2);

        // New interval: both tokens are in the frozen set now (W = 450).
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);

        uint256 pool1 = _pool(D, 225);
        uint256 pool2 = _pool(D, 450);

        // Bob (enrolled at the interval-2 deposit) earns ONLY interval 2.
        vm.prank(bob);
        dist.claimETH(_one(bobId));
        uint256 bobPaid = bobC.received();
        assertApproxEqAbs(bobPaid, pool2 / 2, 2, "minter must accrue from the next interval only");
        assertGt(bobPaid, 0, "minter must eventually accrue");

        // Alice held BOTH intervals: interval-1 pool + half of interval 2.
        vm.prank(alice);
        dist.claimETH(_one(aliceId));
        assertApproxEqAbs(aliceC.received(), pool1 + pool2 / 2, 2, "existing holder keeps both intervals");
        assertLe(bobPaid + aliceC.received(), 2 * D, "conservation under mid-interval mint");
    }

    function test_MintMidInterval_NoOverCommit_ERC20() public {
        uint256 aliceId = membership.mint(alice, 1);
        usdc.mint(dao, D);
        vm.startPrank(dao);
        usdc.approve(address(dist), D);
        dist.depositERC20(usdc, D);
        vm.stopPrank();

        vm.warp(block.timestamp + WINDOW / 2);
        uint256 bobId = membership.mint(bob, 1);
        vm.warp(block.timestamp + WINDOW / 2);

        uint256 pool = _pool(D, 225);
        vm.prank(alice);
        dist.claimERC20(usdc, _one(aliceId));
        assertEq(aliceC.received(), 0); // ETH untouched
        assertEq(usdc.balanceOf(alice), pool, "original holder gets full ERC-20 pool");

        vm.prank(bob);
        vm.expectRevert(NothingToClaim.selector);
        dist.claimERC20(usdc, _one(bobId));

        assertLe(pool, D, "payout exceeded deposit");
        assertEq(usdc.balanceOf(address(dist)), D - pool, "only dust remains");
    }

    // ── Interrupted deposit must carry the unvested remainder (CR comment) ─────

    /// @notice A second deposit BEFORE the first interval's `WINDOW` elapsed must
    ///         not strand the unvested remainder of the first pool. `_closeInterval`
    ///         returns the un-vested share and the next deposit folds it into its
    ///         own pool, so after the second window the holder's total claims equal
    ///         total deposits minus the open dust (nothing left behind).
    function test_InterruptedDeposit_CarriesUnvested() public {
        uint256 aliceId = membership.mint(alice, 1);
        _deposit(D); // interval 1 opens; pool1 = D - (D % 225)
        uint256 pool1 = _pool(D, 225);

        // Interrupt interval 1 halfway through: only half of pool1 vests into the
        // cumulative; the other half is the "unvested remainder" under test.
        vm.warp(block.timestamp + WINDOW / 2);
        _deposit(D); // closes interval 1 and carries the remainder into pool2

        // Let interval 2 fully elapse, then the sole holder claims everything.
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        dist.claimETH(_one(aliceId));
        uint256 claimed = aliceC.received();

        // Nothing stranded: total claims == total deposits - open dust.
        assertApproxEqAbs(claimed, 2 * D - dist.ethDust(), 4, "unvested remainder was stranded");
        // The carried remainder makes the total exceed a single interval's pool.
        assertGt(claimed, pool1, "carry must lift claims above one pool");
        // Only the carried dust is left in the contract.
        assertEq(address(dist).balance, dist.ethDust(), "only dust should remain");
    }

    // ── Burn must settle the outgoing holder (no stranding, no ownerOf revert) ─

    function test_BurnSettlesHolder() public {
        uint256 aliceId = membership.mint(alice, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW / 2);

        uint256 pool = _pool(D, 225);

        // Burn triggers the checkpoint with `to == 0`; the fix settles `from`.
        membership.burn(aliceId);

        // Alice's half-window slice is credited to her pending balance.
        assertEq(dist.pendingClaim(address(0), alice), pool / 2, "burn must settle the holder");

        vm.prank(alice);
        dist.claimPendingETH();
        assertEq(aliceC.received(), pool / 2, "holder claims post-burn");
    }

    // ── Tier CHANGE between deposits must not re-price history (C-1 variant) ───
    //
    // A token's tier (hence weight) can be re-labelled by the membership owner
    // WITHOUT notifying the distributor, so a later deposit runs `_freezeBasis`
    // with a different `_weightOf(i)`. A plain debt re-base would silently
    // re-price ALL historical intervals at the new weight (over-claim on an
    // upgrade, under-claim on a downgrade). The `_carried` buffer preserves the
    // historical slice at the OLD weight and adds it back on claim.

    /// @notice Tier 2 -> Tier 1 between deposits: the holder must receive the
    ///         Tier-2 share for interval 1 PLUS the Tier-1 share for interval 2
    ///         — never the whole history re-priced at the Tier-1 weight.
    function test_TierUpgrade_PreservesHistoricalAccrual() public {
        uint256 aliceId = membership.mint(alice, 2); // Tier 2 (weight 100)

        // Absolute warps (repo convention): a chained relative
        // `vm.warp(block.timestamp + WINDOW)` is not reliable under via_ir and
        // can silently no-op, which would hide the interval-2 accrual.
        uint256 t0 = block.timestamp;

        _deposit(D); // interval 1 opens at t0, W = 100
        uint256 pool1 = dist.ethPricePerWeight();
        assertEq(pool1, _pool(D, 100), "interval-1 pool");

        vm.warp(t0 + WINDOW); // interval 1 fully vests at weight 100

        membership.updateTier(aliceId, 1); // silent Tier 2 -> Tier 1 (weight 225)

        _deposit(D); // interval 2 opens, W = 225
        uint256 pool2 = dist.ethPricePerWeight();
        uint256 cum2 = dist.ethCumReward(); // finalised cumulative through interval 1

        vm.warp(t0 + 2 * WINDOW); // interval 2 fully vests at weight 225

        // Sole holder: interval-1 share at the OLD weight (T2 = 100) + the FULL
        // interval-2 pool at the NEW weight (T1 = 225). A naive debt re-base
        // would instead price interval 1 at 225 (over-claim).
        uint256 share1 = (100 * cum2) / 1e18;
        uint256 expected = share1 + pool2;

        // `_peek` must also report the carried historical slice.
        assertEq(dist.claimableETH(_one(aliceId)), expected, "peek must include carried accrual");

        vm.prank(alice);
        dist.claimETH(_one(aliceId));

        assertEq(aliceC.received(), expected, "upgrade must preserve the historical Tier-2 share");
        // The historical slice is priced at T2 (<= the interval-1 pool), NOT at
        // the upgraded T1 weight (which would be ~2.25x the pool).
        assertLt(share1, pool1, "historical slice must stay at the old T2 weight");
        // Nothing over-claimed: balance equals exactly the remaining liabilities (dust).
        assertEq(address(dist).balance, dist.ethDust(), "distributor balance == remaining liabilities");
        assertLe(aliceC.received(), 2 * D, "claims must not exceed total deposits");
    }

    /// @notice Tier 1 -> Tier 2 between deposits: the holder must receive the
    ///         Tier-1 share for interval 1 PLUS the Tier-2 share for interval 2;
    ///         a naive re-base would erase the higher historical slice (lost funds).
    function test_TierDowngrade_PreservesHistoricalAccrual() public {
        uint256 aliceId = membership.mint(alice, 1); // Tier 1 (weight 225)

        // Absolute warps (see the upgrade test for why).
        uint256 t0 = block.timestamp;

        _deposit(D); // interval 1 opens at t0, W = 225
        uint256 pool1 = dist.ethPricePerWeight();
        assertEq(pool1, _pool(D, 225), "interval-1 pool");

        vm.warp(t0 + WINDOW); // interval 1 fully vests at weight 225

        membership.updateTier(aliceId, 2); // silent Tier 1 -> Tier 2 (weight 100)

        _deposit(D); // interval 2 opens, W = 100
        uint256 pool2 = dist.ethPricePerWeight();
        uint256 cum2 = dist.ethCumReward(); // finalised cumulative through interval 1

        vm.warp(t0 + 2 * WINDOW); // interval 2 fully vests at weight 100

        // Sole holder: interval-1 share at the OLD weight (T1 = 225) + the FULL
        // interval-2 pool at the NEW weight (T2 = 100). A naive re-base would
        // erase ~45% of the historical slice (silent loss of funds).
        uint256 share1 = (225 * cum2) / 1e18;
        uint256 expected = share1 + pool2;

        assertEq(dist.claimableETH(_one(aliceId)), expected, "peek must include carried accrual");

        vm.prank(alice);
        dist.claimETH(_one(aliceId));

        assertEq(aliceC.received(), expected, "downgrade must not lose the historical Tier-1 share");
        // The historical slice is priced at the old T1 weight, NOT the downgraded
        // T2 weight (which would drop it to 100/225 of its value).
        assertGt(share1, (100 * cum2) / 1e18, "historical slice must stay at the old T1 weight");
        // No funds stranded: everything not owed to a holder is only dust.
        assertEq(address(dist).balance, dist.ethDust(), "no funds lost on downgrade");
        assertLe(aliceC.received(), 2 * D, "claims must not exceed total deposits");
    }
}
