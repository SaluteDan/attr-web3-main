// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MembershipFeeDistributor} from "../../../contracts/MembershipFeeDistributor.sol";
import {MockMembershipToken} from "../../../contracts/mocks/MockMembershipToken.sol";
import {MockFeeUSDC, MockFeeOnTransferERC20, MaliciousTierToken} from "../../../contracts/mocks/MockFeeTokens.sol";
import "../../../contracts/Errors.sol";

/**
 * @title MaliciousReceiver
 * @notice Unprivileged attacker that re-enters `claimETH` from its `receive()`.
 * @dev Models the S4 vector: if the distributor advanced its debt AFTER the
 *      external ETH transfer (or omitted the guard), the re-entrant claim would
 *      succeed and the ETH would be double-spent.
 */
contract MaliciousReceiver {
    MembershipFeeDistributor public immutable DISTRIBUTOR;
    uint256[] internal ids;
    bool public reentryReverted;
    bytes public reentryError;
    uint256 public reentries;

    constructor(address distributor_) {
        DISTRIBUTOR = MembershipFeeDistributor(payable(distributor_));
    }

    function arm(uint256[] calldata tokenIds) external {
        ids = tokenIds;
    }

    /// @notice Accept an ERC-721 safe transfer into the attacker.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /// @notice Re-enter `claimETH` once from the payout callback.
    receive() external payable {
        if (reentries == 0) {
            reentries = 1;
            (bool ok, bytes memory reason) = address(DISTRIBUTOR).call(abi.encodeCall(DISTRIBUTOR.claimETH, (ids)));
            reentryReverted = !ok;
            reentryError = reason;
        }
    }

    /// @notice Re-enter the explicit probe path; returns whether the nested call reverted.
    function probe() external returns (bool nestedReverted) {
        (bool ok, bytes memory reason) =
            address(DISTRIBUTOR).call(abi.encodeCall(DISTRIBUTOR.probeETHReentrancy, ()));
        nestedReverted = !ok;
        if (!ok) reentryError = reason;
    }
}

/// @notice Callback probe for ERC-20 claims.
contract MaliciousERC20Receiver {
    MembershipFeeDistributor public immutable DISTRIBUTOR;
    bool public reentryReverted;
    bytes public reentryError;

    constructor(address distributor_) {
        DISTRIBUTOR = MembershipFeeDistributor(payable(distributor_));
    }

    function probe() external returns (bool nestedReverted) {
        (bool ok, bytes memory reason) =
            address(DISTRIBUTOR).call(abi.encodeCall(DISTRIBUTOR.probeERC20Reentrancy, ()));
        nestedReverted = !ok;
        if (!ok) reentryReverted = true;
        reentryError = reason;
    }
}

/// @notice ERC-721-receiver-capable ETH payee for adversarial harness actors.
contract ActorC {
    /// @notice Accept claim payouts; event + storage write make the body non-empty.
    event Paid(uint256 amount);

    /// @notice Total ETH ever received (proves the receive body executed).
    uint256 public received;

    /// @notice Accept ETH pushes/claims.
    receive() external payable {
        received += msg.value;
        emit Paid(msg.value);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

/**
 * @title MembershipFeeDistributorSecurityTest
 * @notice Adversarial half of the tier-weighted distributor suite (S1–S12) plus
 *         the four MUST-PASS regression tests for the two CRITICAL fixes
 *         (F1 snapshot rental, F2 retroactive dilution).
 *
 * @dev The F1/F2 tests were authored BEFORE the fix (TDD) and FAIL on the prior
 *      implementation at `b969c42`; they PASS on the checkpoint + frozen-weight
 *      implementation.
 */
contract MembershipFeeDistributorSecurityTest is Test {
    MembershipFeeDistributor internal dist;
    MockMembershipToken internal membership;
    MockFeeUSDC internal usdc;

    address internal dao = address(0xDA0);
    ActorC internal alice;
    ActorC internal bob;
    ActorC internal carol;
    address internal aliceAddr;
    address internal bobAddr;
    address internal carolAddr;

    uint256 internal constant WINDOW = 1 days;
    uint256 internal constant D = 100 ether;

    function setUp() public {
        membership = new MockMembershipToken("ATTR-MEMBER-ID", "ATTR#");
        dist = new MembershipFeeDistributor(address(membership), dao);
        membership.setFeeDistributor(address(dist));
        usdc = new MockFeeUSDC();
        vm.deal(dao, 10_000 ether);
        alice = new ActorC();
        bob = new ActorC();
        carol = new ActorC();
        aliceAddr = address(alice);
        bobAddr = address(bob);
        carolAddr = address(carol);
        vm.deal(aliceAddr, 1 ether);
        vm.deal(bobAddr, 1 ether);
        vm.deal(carolAddr, 1 ether);
        vm.warp(1_700_000_000);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _openGate() internal {
        vm.prank(dao);
        dist.setTotalMintedSnapshot(type(uint256).max);
    }

    function _deposit(uint256 amount) internal {
        vm.prank(dao);
        dist.depositETH{value: amount}();
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory out) {
        out = new uint256[](1);
        out[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory out) {
        out = new uint256[](2);
        out[0] = a;
        out[1] = b;
    }

    /// @dev Claim helper returning the actually received ETH (attacker-safe).
    function _claimETH(address who, uint256[] memory ids) internal returns (uint256 paid) {
        return _claimETH(who, dist, ids);
    }

    /// @dev Claim helper for a freshly deployed distributor instance.
    function _claimETH(address who, MembershipFeeDistributor d, uint256[] memory ids) internal returns (uint256 paid) {
        uint256 before = who.balance;
        vm.prank(who);
        (bool ok, bytes memory reason) = address(d).call(abi.encodeCall(d.claimETH, (ids)));
        if (!ok) {
            assembly {
                revert(add(reason, 32), mload(reason))
            }
        }
        paid = who.balance - before;
    }

    /// @dev Total bps of `D` represented by `amount`.
    function _bps(uint256 amount) internal pure returns (uint256) {
        return (amount * 10_000) / D;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // F1 / F2 REGRESSION SUITE (MUST FAIL on b969c42, PASS on the fix)
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * @notice F1 — snapshot rental defeated by continuous ownership.
     *
     * Victim holds the full WINDOW, never claims, then transfers to the attacker
     * AT `t = WINDOW`. The attacker must capture < 10 bps of the deposit
     * (vs ~9999 bps on `b969c42`, where `dt = now - lastDeposit` was paid to the
     * current `ownerOf`). The victim must still claim their full accrued share
     * via `pendingClaims`.
     */
    function test_SnapshotRentalDefeatedByContinuousOwnership() public {
        _openGate();
        uint256 id = membership.mint(aliceAddr, 1); // sole member: w/W == 1
        _deposit(D);

        // Victim (alice) holds the entire window without claiming.
        vm.warp(block.timestamp + WINDOW);

        // Attacker (bob) acquires the token at the end of the interval.
        vm.prank(aliceAddr);
        membership.transferFrom(aliceAddr, bobAddr, id);

        // The buyer's claimable is ~0: value binds to holding duration, not to
        // time-since-deposit.
        uint256[] memory one = _ids(id);
        uint256 attackerDue = dist.claimableETH(one);
        uint256 attackerBps = _bps(attackerDue);
        assertLt(attackerBps, 10, "attacker must capture < 10 bps of the interval");

        vm.prank(bobAddr);
        vm.expectRevert(NothingToClaim.selector);
        dist.claimETH(one);

        // The victim keeps their holding-period share in pendingClaims.
        uint256 victimPending = dist.pendingClaim(address(0), aliceAddr);
        assertApproxEqRel(victimPending, D, 0.001e18, "victim keeps ~the full interval share");
        assertGt(victimPending, (D * 9_900) / 10_000, "victim retains >= 99% of the interval");

        // Victim claims their settled balance even though the NFT is gone
        // (F-2: post-sale pull). Direct `claimETH` on an id they no longer own
        // must revert; the settled-balance path is `claimPendingETH`.
        vm.prank(aliceAddr);
        vm.expectRevert(abi.encodeWithSelector(NotTokenOwner.selector, id));
        dist.claimETH(one);

        uint256 before = aliceAddr.balance;
        vm.prank(aliceAddr);
        dist.claimPendingETH();
        uint256 received = aliceAddr.balance - before;
        assertApproxEqRel(received, victimPending, 0.0001e18, "seller claims their settled share");

        // Conservation holds.
        assertLe(dist.totalClaimedETH(), D);
        assertLe(dist.totalClaimedETH() + dist.ethDust(), D);
    }

    /**
     * @notice F2 — retroactive dilution prevented by the frozen denominator.
     *
     * Honest T1 holds; deposit happens; an attacker then mints 9x supply
     * mid-interval. On `b969c42` the live `_liveWeight()` denominator shrank the
     * honest payout ~90%. With the frozen `intervalWeight` the honest holder
     * still claims their full original due, and conservation holds.
     */
    function test_RetroactiveDilutionPrevented_F2() public {
        _openGate();
        uint256 id = membership.mint(aliceAddr, 1); // W = 225
        _deposit(D);

        // Snapshot the honest due as of mid-interval.
        vm.warp(block.timestamp + WINDOW / 2);
        uint256 dueMid = dist.claimableETH(_ids(id));

        // Attacker mints 9x supply mid-interval: W grows from 225 to 2025.
        membership.mintMany(bobAddr, 9, 0); // 9 more T1
        assertEq(dist.liveWeight(), 225 + 9 * 225, "live weight grew 10x");

        // Frozen denominator => the honest due is unchanged by the mint.
        uint256 dueAfterMint = dist.claimableETH(_ids(id));
        assertEq(dueAfterMint, dueMid, "mid-interval mint must not re-price accrued value");

        // Finish the window and claim the full original share.
        vm.warp(block.timestamp + WINDOW / 2);
        uint256 dueFull = dist.claimableETH(_ids(id));
        assertApproxEqRel(dueFull, D, 0.001e18, "honest holder keeps ~100% of the sole-member pool");

        uint256 paid = _claimETH(aliceAddr, _ids(id));
        assertApproxEqRel(paid, D, 0.001e18, "no ~90% dilution");

        // Conservation against the deposit (the attacker's late mints earn nothing
        // from this interval because they were not held during it).
        assertLe(paid + dist.ethDust(), D, "conservation holds");
        assertLe(dist.totalClaimedETH(), D);
    }

    /**
     * @notice F1 — holding-period split on transfer.
     *
     * Deposit -> hold 50% window -> transfer -> hold 50% as the new owner ->
     * claim. Seller and buyer each get ~50% of the interval pool.
     */
    function test_HoldingPeriodSplitOnTransfer() public {
        _openGate();
        uint256 id = membership.mint(aliceAddr, 1); // sole member: w/W == 1
        _deposit(D);

        // Alice holds the first half of the window.
        vm.warp(block.timestamp + WINDOW / 2);
        vm.prank(aliceAddr);
        membership.transferFrom(aliceAddr, bobAddr, id);

        // Bob holds the second half.
        vm.warp(block.timestamp + WINDOW / 2);

        uint256 alicePending = dist.pendingClaim(address(0), aliceAddr);
        uint256 bobDue = dist.claimableETH(_ids(id));

        // Each side earns ~half the pool.
        assertApproxEqRel(alicePending, D / 2, 0.01e18, "seller keeps ~50%");
        assertApproxEqRel(bobDue, D / 2, 0.01e18, "buyer accrues ~50%");

        // Both can claim their halves; conservation holds.
        vm.prank(aliceAddr);
        dist.claimPendingETH();
        uint256 bobPaid = _claimETH(bobAddr, _ids(id));
        assertApproxEqRel(alicePending + bobPaid, D, 0.01e18, "the two halves reconstitute the pool");
        assertLe(dist.totalClaimedETH() + dist.ethDust(), D);
    }

    /**
     * @notice F-2 — keeper-gated push.
     *
     * Push reverts for a non-keeper; a keeper push works only above the dust
     * threshold; and it can only move value already accrued (never non-accrued
     * or third-party funds).
     */
    function test_KeeperGatedPush() public {
        _openGate();
        uint256 id = membership.mint(aliceAddr, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(aliceAddr);
        membership.transferFrom(aliceAddr, bobAddr, id); // settle alice's balance

        uint256 alicePending = dist.pendingClaim(address(0), aliceAddr);
        assertApproxEqRel(alicePending, D, 0.001e18, "alice accrued the full pool");

        // (a) Non-keeper push reverts.
        vm.prank(bobAddr);
        vm.expectRevert(Unauthorized.selector);
        dist.pushRewards(aliceAddr);

        // (b) Keeper push below threshold reverts (value accrues silently).
        vm.prank(dao);
        dist.setKeeper(carolAddr);
        vm.prank(dao);
        dist.setDustThreshold(address(0), D * 2); // threshold above the balance
        vm.prank(carolAddr);
        vm.expectRevert(NothingToClaim.selector);
        dist.pushRewards(aliceAddr);

        // (c) Keeper push above threshold moves exactly the accrued balance.
        vm.prank(dao);
        dist.setDustThreshold(address(0), D / 2); // threshold below the balance
        uint256 before = aliceAddr.balance;
        vm.prank(carolAddr);
        dist.pushRewards(aliceAddr);
        assertEq(aliceAddr.balance - before, alicePending, "push moves exactly the accrued amount");
        assertEq(dist.pendingClaim(address(0), aliceAddr), 0, "balance zeroed after push");

        // (d) Push cannot move non-accrued funds: a holder with no balance reverts
        //     and the contract keeps its whole balance.
        uint256 contractBefore = address(dist).balance;
        vm.prank(carolAddr);
        vm.expectRevert(NothingToClaim.selector);
        dist.pushRewards(aliceAddr);
        vm.prank(carolAddr);
        vm.expectRevert(NothingToClaim.selector);
        dist.pushRewards(carolAddr);
        assertEq(address(dist).balance, contractBefore, "push cannot move unaccrued funds");
    }

    // ── S1 CRITICAL: snapshot rental / interval accrual ───────────────────────

    /// @notice Value accrues over genuine holding intervals; churn cannot capture
    ///         a period's share without holding, and lifetime payouts never exceed D.
    function test_SnapshotRental_IntervalAccrualRequired() public {
        _openGate();
        uint256 id = membership.mint(aliceAddr, 1);
        _deposit(D);

        // (a) Zero-hold rent: bob acquires the token and claims in the SAME block.
        vm.prank(aliceAddr);
        membership.transferFrom(aliceAddr, bobAddr, id);
        uint256[] memory one = _ids(id);
        assertEq(dist.claimableETH(one), 0, "zero-hold rental accrues nothing");
        vm.prank(bobAddr);
        vm.expectRevert(NothingToClaim.selector);
        dist.claimETH(one);

        // (b) Rent for a fraction of the window, then claim.
        vm.warp(block.timestamp + WINDOW / 4);
        uint256 quarterPayout = _claimETH(bobAddr, one);
        assertGt(quarterPayout, 0, "quarter-window hold must accrue");
        assertLt(quarterPayout, D, "partial hold must not capture the whole deposit");

        // (c) Transfer to carol, who holds longer and claims more.
        vm.prank(bobAddr);
        membership.transferFrom(bobAddr, carolAddr, id);
        vm.warp(block.timestamp + WINDOW / 2);
        uint256 halfPayout = _claimETH(carolAddr, one);
        assertGt(halfPayout, quarterPayout, "longer holding must earn more");

        // Conservation: payouts never exceed the deposit.
        uint256 accounted = quarterPayout + halfPayout;
        assertLe(accounted, D, "sum of payouts must never exceed the deposit");
        assertEq(dist.totalClaimedETH(), accounted, "claimed ledger matches payouts");

        // Completing the window pays the residual.
        vm.warp(block.timestamp + WINDOW);
        uint256 finalPayout = _claimETH(carolAddr, one);
        assertLe(accounted + finalPayout, D, "lifetime payouts never exceed the deposit");
        assertEq(dist.totalClaimedETH(), accounted + finalPayout);
    }

    // ── S2 CRITICAL: literal-percentage insolvency ────────────────────────────

    /// @notice The weighted implementation is solvent for every nT1 (1..50);
    ///         a literal-percentage variant would exceed 100% at nT1 = 23.
    function test_LiteralPercentagesAreInsolvent() public {
        _openGate();
        for (uint256 n = 1; n <= 50; ++n) {
            MockMembershipToken m = new MockMembershipToken("ATTR-MEMBER-ID", "ATTR#");
            MembershipFeeDistributor d = new MembershipFeeDistributor(address(m), dao);
            m.setFeeDistributor(address(d));
            vm.prank(dao);
            d.setTotalMintedSnapshot(type(uint256).max);
            m.mintMany(aliceAddr, n, 0);
            vm.prank(dao);
            d.depositETH{value: D}();

            uint256[] memory ids = new uint256[](n);
            for (uint256 i = 0; i < n; ++i) {
                ids[i] = i;
            }
            vm.warp(block.timestamp + WINDOW);
            uint256 paid = _claimETH(aliceAddr, d, ids);
            assertLe(paid, D, "weighted payout must never exceed the deposit");
        }

        // Rejected-design arithmetic: 23 x 450 bps = 10350 bps > 10000 bps.
        assertGt(uint256(23 * 450), uint256(10_000), "literal percentages are insolvent past 22 members");

        // Structural proof of absence: weights are relative and normalised.
        assertEq(membership.tierWeight(1), 225);
        assertEq(membership.tierWeight(2), 100);
        assertEq(membership.tierWeight(0), 0);
    }

    // ── S3 HIGH: tier spoofing ────────────────────────────────────────────────

    /// @notice Tier comes only from `membershipToken.getTier(id)`; a T2 token is
    ///         paid at T2 weight exactly and no path accepts a caller tier.
    function test_TierSpoofingReverts() public {
        _openGate();
        uint256 t1 = membership.mint(aliceAddr, 1);
        uint256 t2 = membership.mint(aliceAddr, 2);
        _deposit(D);

        // No tier override exists in calldata: a "poisoned" extra argument reverts.
        uint256[] memory one = _ids(t2);
        (bool ok, ) = address(dist).call(abi.encodeWithSignature("claimETH(uint256[],uint256)", one, 1));
        assertFalse(ok, "no function may accept a caller-supplied tier");

        vm.warp(block.timestamp + WINDOW);
        uint256 dueT1 = dist.claimableETH(_ids(t1));
        uint256 dueT2 = dist.claimableETH(one);
        assertLt(dueT2, dueT1, "T2 payout must be below T1 payout");
        assertApproxEqRel(dueT1, (dueT2 * 225) / 100, 0.001e18, "T1 == 2.25x T2");

        uint256 paidT2 = _claimETH(aliceAddr, one);
        assertApproxEqRel(paidT2, dueT2, 0.0001e18, "T2 paid at T2 weight only");

        vm.prank(aliceAddr);
        vm.expectRevert(NothingToClaim.selector);
        dist.claimETH(one);
    }

    // ── S4 HIGH: reentrancy on claimETH ───────────────────────────────────────

    /// @notice The re-entrant call reverts; the first claim succeeds exactly once.
    function test_ClaimETHReentrancy_CEI() public {
        _openGate();
        MaliciousReceiver attacker = new MaliciousReceiver(address(dist));
        vm.deal(address(attacker), 1 ether);
        uint256 id = membership.mint(address(attacker), 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);

        uint256[] memory ids = _ids(id);
        attacker.arm(ids);
        uint256 paid = _claimETH(address(attacker), ids);

        assertApproxEqRel(paid, D, 0.0001e18, "single legitimate claim pays the weighted share");
        assertTrue(attacker.reentryReverted(), "re-entrant claim must revert");
        assertEq(
            bytes4(attacker.reentryError()),
            bytes4(keccak256("ReentrancyGuardReentrantCall()")),
            "guard error expected"
        );
        assertLe(address(dist).balance, D / 1e15, "no double spend: residual dust only");
        assertEq(dist.claimableETH(ids), 0, "debt advanced before the external call");

        // The guard is free outside a claim, so a fresh probe succeeds.
        assertFalse(attacker.probe(), "guard is free once the claim has returned");
        assertEq(dist.ethReentrancyReverted(), 1, "probe accepted when no guard is live");

        MaliciousERC20Receiver erc20Probe = new MaliciousERC20Receiver(address(dist));
        assertFalse(erc20Probe.probe(), "no guard is live outside a claim");
        assertEq(dist.erc20ReentrancyReverted(), 1);
    }

    // ── S5 HIGH: stale / zero / manipulated snapshot ──────────────────────────

    /// @notice The gate fails closed at 0; a stale value cannot mis-pay because the
    ///         denominator is the frozen interval weight, not the gate value.
    function test_SnapshotFailClosed() public {
        membership.mint(aliceAddr, 1);
        membership.mint(bobAddr, 2);

        vm.prank(dao);
        vm.expectRevert(InvalidMaxSupply.selector);
        dist.depositETH{value: 1 ether}();

        vm.prank(dao);
        dist.setTotalMintedSnapshot(uint256(1));
        vm.prank(dao);
        dist.depositETH{value: 1 ether}();
        assertEq(dist.ethPricePerWeight(), uint256(1 ether) - (uint256(1 ether) % uint256(325)), "pool = D - residue");
        assertEq(dist.ethIntervalWeight(), 325, "frozen denominator = live W at deposit");

        vm.prank(dao);
        dist.setTotalMintedSnapshot(uint256(1e30));
        vm.prank(dao);
        dist.depositETH{value: 1 ether}();

        vm.warp(block.timestamp + WINDOW);
        uint256[] memory ids = _ids(0);
        uint256 owed = dist.claimableETH(ids);
        assertLe(owed, address(dist).balance, "balance can never be drawn below owed amounts");
        uint256 paid = _claimETH(aliceAddr, ids);
        assertEq(paid, owed);
        assertTrue(
            dist.claimableETH(_ids(1)) <= address(dist).balance,
            "bob's claim stays collateralised"
        );
    }

    // ── S6 HIGH: duplicate ids in batch ───────────────────────────────────────

    /// @notice `claimETH([id,id])` pays once; the debt is advanced per iteration.
    function test_DuplicateTokenIdsInBatch() public {
        _openGate();
        uint256 id = membership.mint(aliceAddr, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);

        uint256[] memory dup = _ids(id, id);
        uint256 paid = _claimETH(aliceAddr, dup);
        assertApproxEqRel(paid, D, 0.0001e18, "duplicate entries must not amplify the payout");
        assertEq(dist.claimableETH(_ids(id)), 0);
    }

    // ── S7 MEDIUM: cross-transaction replay ───────────────────────────────────

    /// @notice A second claim with no intervening deposit reverts `NothingToClaim`.
    function test_ClaimReplayAcrossTx() public {
        _openGate();
        uint256 id = membership.mint(aliceAddr, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);

        uint256[] memory ids = _ids(id);
        vm.prank(aliceAddr);
        dist.claimETH(ids);

        vm.prank(aliceAddr);
        vm.expectRevert(NothingToClaim.selector);
        dist.claimETH(ids);

        uint256 cumBefore = dist.ethCumReward();
        _deposit(D);
        assertGe(dist.ethCumReward(), cumBefore, "cumulative index is monotonic non-decreasing");
    }

    // ── S8 MEDIUM: rounding / dust farming ────────────────────────────────────

    /// @notice Payouts + dust never exceed deposits; dust stays bounded.
    function testFuzz_DustConservation(uint96 amount, uint8 nT1, uint8 nT2) public {
        amount = uint96(bound(amount, 1, 1_000 ether));
        nT1 = uint8(bound(nT1, 0, 12));
        nT2 = uint8(bound(nT2, 0, 12));
        vm.assume(uint256(nT1) + uint256(nT2) > 0);

        _openGate();
        membership.mintMany(aliceAddr, nT1, nT2);
        uint256 total = nT1 + nT2;

        uint256[] memory ids = new uint256[](total);
        for (uint256 i = 0; i < total; ++i) {
            ids[i] = i;
        }

        _deposit(amount);
        uint256 dustAfterFirst = dist.ethDust();

        _deposit(amount);
        assertLe(dist.ethDust(), 2 * uint256(amount), "dust bounded by deposits to date");

        vm.warp(block.timestamp + WINDOW);
        uint256 due = dist.claimableETH(ids);
        uint256 paid = due == 0 ? 0 : _claimETH(aliceAddr, ids);

        uint256 claimed = dist.totalClaimedETH();
        assertEq(claimed, paid);
        assertLe(claimed + dist.ethDust(), 2 * uint256(amount), "payments + dust <= deposits");
        assertLe(paid, 2 * uint256(amount));
        assertTrue(dustAfterFirst <= 2 * uint256(amount));
    }

    // ── S9 MEDIUM: non-standard ERC20 ─────────────────────────────────────────

    /// @notice Fee-on-transfer credit is the received delta, so claims can never
    ///         exceed the contract's real balance.
    function test_NonStandardERC20() public {
        _openGate();
        membership.mintMany(aliceAddr, 4, 0);
        MockFeeOnTransferERC20 fee = new MockFeeOnTransferERC20(500); // 5%
        fee.mint(dao, 1_000e6);

        uint256 nominal = 1_000e6;
        vm.startPrank(dao);
        fee.approve(address(dist), nominal);
        dist.depositERC20(fee, nominal);
        vm.stopPrank();

        uint256 received = 950e6;
        assertEq(fee.balanceOf(address(dist)), received, "contract only holds the delivered delta");
        assertEq(dist.erc20PricePerWeight(fee), received - (received % 900), "pool = delta - residue");

        vm.warp(block.timestamp + WINDOW);
        uint256[] memory ids = new uint256[](4);
        for (uint256 i = 0; i < 4; ++i) {
            ids[i] = i;
        }
        vm.prank(aliceAddr);
        dist.claimERC20(fee, ids);
        uint256 paid = dist.totalClaimedERC20(fee);
        assertLe(paid, received, "claims cannot exceed the real balance");
        assertEq(fee.balanceOf(address(dist)), received - paid, "residue is unclaimable dust");
        assertLe(dist.totalClaimedERC20(fee) + dist.erc20Dust(fee), received);
    }

    // ── S10 MEDIUM: ownership boundary ────────────────────────────────────────

    /// @notice Every state-mutating entry point is owner-gated; stray ETH reverts.
    function test_OnlyOwnerGates() public {
        vm.startPrank(bobAddr);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bobAddr));
        dist.depositETH{value: 1 ether}();
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bobAddr));
        dist.depositERC20(usdc, 1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bobAddr));
        dist.setTotalMintedSnapshot(1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bobAddr));
        dist.sweepDustETH();
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bobAddr));
        dist.setKeeper(bobAddr);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bobAddr));
        dist.setDustThreshold(address(0), 1);
        vm.stopPrank();

        vm.prank(bobAddr);
        (bool ok, ) = address(dist).call{value: 1 ether}("");
        assertFalse(ok, "stray ETH must be rejected");
    }

    /// @notice `checkpoint` is callable ONLY by the registered membership token.
    function test_CheckpointOnlyCallableByMembershipToken() public {
        _openGate();
        uint256 id = membership.mint(aliceAddr, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW / 2);

        vm.prank(bobAddr);
        vm.expectRevert(Unauthorized.selector);
        dist.checkpoint(id, aliceAddr, bobAddr);

        vm.prank(dao);
        vm.expectRevert(Unauthorized.selector);
        dist.checkpoint(id, aliceAddr, bobAddr);
    }

    // ── S11 LOW: nonexistent token / T0 attempt ───────────────────────────────

    /// @notice `getTier` reverts for unminted ids and the claim propagates it —
    ///         never a silent zero.
    function test_NonexistentTokenReverts() public {
        _openGate();
        membership.mint(aliceAddr, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);

        uint256[] memory ghost = _ids(999);
        vm.prank(aliceAddr);
        vm.expectRevert();
        dist.claimETH(ghost);

        uint256 id = membership.mint(aliceAddr, 1);
        membership.updateTier(id, 0);
        vm.prank(aliceAddr);
        vm.expectRevert(NothingToClaim.selector);
        dist.claimETH(_ids(id));
        assertEq(dist.claimableETH(_ids(id)), 0);
    }

    // ── S12 LOW: weight math overflow ─────────────────────────────────────────

    /// @notice Checked arithmetic reverts instead of wrapping; realistic supply is
    ///         far from uint256 limits (50k T1 + 50k T2 => W = 16,250,000).
    function testFuzz_WeightOverflow(uint128 nT1, uint128 nT2) public {
        nT1 = uint128(bound(nT1, 0, 50_000));
        nT2 = uint128(bound(nT2, 0, 50_000));
        vm.assume(uint256(nT1) + uint256(nT2) > 0);

        uint256 w = 225 * uint256(nT1) + 100 * uint256(nT2);
        assertEq(w, 225 * uint256(nT1) + 100 * uint256(nT2));
        assertLe(w, 16_250_000, "ceiling for 50k + 50k");
        assertTrue(w < type(uint256).max);
    }

    // ── Malicious token: tier flip mid-batch ──────────────────────────────────

    /// @notice A token that flips tier on read cannot extract more than the deposit:
    ///         the frozen interval weight of a sole token caps the payout at the
    ///         interval pool, and no more than the contract's real balance leaves.
    function test_MaliciousTokenTierFlipMidBatchIsBoundedToAvailableBalance() public {
        MaliciousTierToken evil = new MaliciousTierToken();
        MembershipFeeDistributor d = new MembershipFeeDistributor(address(evil), dao);
        evil.setFeeDistributor(address(d));
        vm.prank(dao);
        d.setTotalMintedSnapshot(type(uint256).max);

        uint256 id = evil.mint(aliceAddr, 2); // honest supply weight: W = 100
        vm.prank(dao);
        d.depositETH{value: D}();
        vm.warp(block.timestamp + WINDOW);

        evil.setToggle(true); // every getTier now reports the WRONG tier
        uint256[] memory ids = _ids(id);
        // With a single token w/W == 1, so the payout is the pool and can never exceed D.
        assertLe(d.claimableETH(ids), D, "forged read cannot exceed the deposit");
        uint256 paid = _claimETH(aliceAddr, d, ids);
        assertLe(paid, D, "payout is bounded by the deposit");
        assertEq(address(d).balance, D - paid, "contract retains its real balance");
        assertEq(d.totalClaimedETH(), paid);
    }
}
