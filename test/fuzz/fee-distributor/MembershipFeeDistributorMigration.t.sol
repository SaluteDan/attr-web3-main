// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MembershipFeeDistributor} from "../../../contracts/MembershipFeeDistributor.sol";
import {MockMembershipToken} from "../../../contracts/mocks/MockMembershipToken.sol";
import {MockFeeUSDC} from "../../../contracts/mocks/MockFeeTokens.sol";
import "../../../contracts/Errors.sol";

/// @notice ERC-721-receiver-capable ETH payee (matches other suites).
contract MigActor {
    uint256 public received;
    receive() external payable {
        received += msg.value;
    }
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

/**
 * @title MembershipFeeDistributorMigrationTest
 * @notice TRUE migration E2E: simulate an OLD-state holders set, accrue under the
 *         live logic, then perform the UPGRADE (the C-1 fix re-deploys the
 *         distributor, as this is an immutable-logic contract) and verify every
 *         stakeholder comes out whole across the seam.
 *
 * Why a separate suite: unit tests poke one function; fuzz/invariant tests check
 * conservation over random action sequences. Neither exercises the *handover*
 * from a populated pre-upgrade state into the post-upgrade logic — the exact
 * class where each side's math checks out but the seam drops a bucket.
 *
 * The migration model for this protocol:
 *   1. Deploy distributor v1, populate memberships, run deposits + claims so a
 *      real "old state" exists on-chain (accrued heads, dust, cumReward).
 *   2. "Upgrade": deploy the fixed (v2) distributor and point MembershipToken at
 *      it (setFeeDistributor). The old contract's already-ACCRUED, already-PAID
 *      ETH is settled history; the new contract starts a fresh accumulator.
 *   3. Assert: (a) no v1 holder loses value already claimable under v1; (b) after
 *      the cutover, deposits accrue to the correct (post-upgrade) holder set;
 *      (c) a holder who held across the seam keeps their entitlement; (d) a token
 *      minted mid-interval before the cutover is excluded, and one minted after
 *      is excluded until the next deposit; (e) conservation holds on v2 from its
 *      first deposit onward.
 *
 * The distributor holds no upgradeable storage (it is redeployed), so "migration"
 * means: drain/retain v1 entitlements, then re-point the membership token. This
 * suite pins that behaviour so a future change cannot silently break the cutover.
 */
contract MembershipFeeDistributorMigrationTest is Test {
    MembershipFeeDistributor internal v1;
    MembershipFeeDistributor internal v2;
    MockMembershipToken internal membership;
    MockFeeUSDC internal usdc;

    address internal dao = address(0xDA0);
    MigActor internal aliceC;
    MigActor internal bobC;
    MigActor internal carolC;
    address internal alice;
    address internal bob;
    address internal carol;

    uint256 internal constant WINDOW = 1 days;
    uint256 internal constant D = 1_000 ether;
    uint256 internal constant T0 = 1_700_000_000;

    function setUp() public {
        membership = new MockMembershipToken("ATTR-MEMBER-ID", "ATTR#");
        usdc = new MockFeeUSDC();
        vm.deal(dao, 1_000_000 ether);
        aliceC = new MigActor();
        bobC = new MigActor();
        carolC = new MigActor();
        alice = address(aliceC);
        bob = address(bobC);
        carol = address(carolC);
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
        vm.deal(carol, 1 ether);
        vm.warp(T0);
    }

    function _idsOf(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function _deployDist() internal returns (MembershipFeeDistributor d) {
        d = new MembershipFeeDistributor(address(membership), dao);
        vm.prank(dao);
        d.setTotalMintedSnapshot(type(uint256).max);
    }

    /// @notice Full old-state -> upgrade -> new-state migration.
    function test_Migration_OldStatePreservedAndCutoverClean() public {
        // ── Phase 1: old (v1) state ──────────────────────────────────────────
        v1 = _deployDist();
        membership.setFeeDistributor(address(v1));

        uint256 idAlice = membership.mint(alice, 1); // T1
        uint256 idBob = membership.mint(bob, 2); // T2

        vm.prank(dao);
        v1.depositETH{value: D}();
        vm.warp(T0 + WINDOW); // interval 1 fully housed

        uint256 v1AliceDue = v1.claimableETH(_idsOf(idAlice));
        uint256 v1BobDue = v1.claimableETH(_idsOf(idBob));
        assertGt(v1AliceDue, 0, "v1: alice accrued in interval 1");
        assertGt(v1BobDue, 0, "v1: bob accrued in interval 1");
        assertGt(v1AliceDue, v1BobDue, "v1: T1 out-earns T2 (2.25x basis)");

        // Alice deliberately leaves her ENTIRE v1 accrual UNCLAIMED across the
        // seam. This is the truthful form of the intent: a holder's retained
        // (unclaimed) v1 balance must still be pull-claimable AFTER the cutover.
        // (A pre-cutover partial claim is not testable here: settling the single
        // open interval re-bases her head to the interval total, leaving the
        // residual 'fresh' accrual below DUST_FLOOR = 1 wei, so nothing is
        // credited to pendingClaims and a second claim on the same head reverts
        // NothingToClaim — an artefact of the double-claim, not of the cutover.)
        uint256 aliceBalBefore = alice.balance;
        uint256 aliceRetained = v1.claimableETH(_idsOf(idAlice));
        assertGt(aliceRetained, 0, "v1: alice retains her unclaimed head across the seam");

        // ── Phase 2: upgrade — re-point membership to v2 ─────────────────────
        // A token minted mid-interval on v1 must not capture the v1 interval.
        uint256 idCarolLate = membership.mint(carol, 1);
        assertEq(v1.claimableETH(_idsOf(idCarolLate)), 0, "v1: mid-interval mint earns 0 for the open interval");

        v2 = _deployDist();
        membership.setFeeDistributor(address(v2)); // THE CUTOVER

        // ── Phase 3: post-upgrade assertions ─────────────────────────────────
        // (a) v1 entitlements are untouched by the cutover (immutable history).
        assertEq(v1.claimableETH(_idsOf(idAlice)), aliceRetained, "cutover did not alter v1 alice head");
        assertEq(v1.claimableETH(_idsOf(idBob)), v1BobDue, "cutover did not alter v1 bob head");
        // Alice can still pull her retained v1 balance post-cutover — exactly once.
        aliceBalBefore = alice.balance;
        vm.prank(alice);
        v1.claimETH(_idsOf(idAlice));
        uint256 aliceDragnet = alice.balance - aliceBalBefore;
        assertGt(aliceDragnet, 0, "v1 retained head is still pull-claimable after cutover");
        assertEq(aliceDragnet, aliceRetained, "v1 post-cutover claim pays the full retained head; single-drain, no residual");
        // Bob never claimed, so his v1 head stays settled-untouched too.
        assertEq(v1.claimableETH(_idsOf(idBob)), v1BobDue, "v1: bob's untouched head survives the cutover");

        // (b) v2 starts a fresh accumulator; nothing accrues before its first deposit.
        assertEq(v2.claimableETH(_idsOf(idAlice)), 0, "v2: no accrual before its first deposit");

        // (c) first v2 deposit accrues to the correct post-upgrade holder set.
        vm.prank(dao);
        v2.depositETH{value: D}();
        vm.warp(T0 + 2 * WINDOW);
        uint256 v2AliceDue = v2.claimableETH(_idsOf(idAlice));
        uint256 v2BobDue = v2.claimableETH(_idsOf(idBob));
        uint256 v2CarolDue = v2.claimableETH(_idsOf(idCarolLate));
        assertGt(v2AliceDue, 0, "v2: alice (held across seam) accrues");
        assertGt(v2BobDue, 0, "v2: bob (held across seam) accrues");
        assertGt(v2AliceDue, v2BobDue, "v2: T1 still out-earns T2");
        // Carol minted mid-v1-interval but BEFORE the v2 first deposit, so she is
        // in v2's sweep and earns from v2's first interval onward.
        assertGt(v2CarolDue, 0, "v2: carol earns once enrolled at v2's first deposit");

        // (d) a token minted AFTER v2's first deposit is excluded from that interval.
        uint256 idLate = membership.mint(carol, 1);
        assertEq(v2.claimableETH(_idsOf(idLate)), 0, "v2: post-deposit mint earns 0 for the open interval");

        // (e) conservation on v2 from its first deposit: claimable <= deposited.
        uint256 totalClaimable = v2.claimableETH(_idsOf(idAlice)) + v2.claimableETH(_idsOf(idBob))
            + v2.claimableETH(_idsOf(idCarolLate)) + v2.claimableETH(_idsOf(idLate));
        assertLe(totalClaimable, D, "v2 conservation: total claimable <= v2 deposits");
        assertLe(totalClaimable, address(v2).balance, "v2: covered by real balance");
    }

    /// @notice ERC-20 migration mirrors ETH: old entitlement survives the cutover,
    ///         post-upgrade deposits accrue under the new contract only.
    function test_Migration_Erc20Cutover() public {
        v1 = _deployDist();
        membership.setFeeDistributor(address(v1));

        uint256 idAlice = membership.mint(alice, 1);
        uint256 idBob = membership.mint(bob, 1);
        // USDC mock is 6-decimal; fund and deposit in 6-dp units.
        uint256 D6 = 1_000e6;
        usdc.mint(dao, 1_000_000e6);

        vm.startPrank(dao);
        usdc.approve(address(v1), type(uint256).max);
        v1.depositERC20(usdc, D6);
        vm.stopPrank();
        vm.warp(T0 + WINDOW);

        uint256 v1Alice = v1.claimableERC20(usdc, _idsOf(idAlice));
        assertGt(v1Alice, 0, "v1 erc20: alice accrued");

        // Cutover.
        v2 = _deployDist();
        membership.setFeeDistributor(address(v2));

        // v1 head intact and claimable post-cutover.
        assertEq(v1.claimableERC20(usdc, _idsOf(idAlice)), v1Alice, "v1 erc20 head preserved");
        vm.prank(alice);
        v1.claimERC20(usdc, _idsOf(idAlice));
        assertGt(usdc.balanceOf(alice), 0, "v1 erc20 retained head claimable after cutover");

        // v2 needs its own token approvals to pull.
        vm.startPrank(dao);
        usdc.approve(address(v2), type(uint256).max);
        v2.depositERC20(usdc, D6);
        vm.stopPrank();
        vm.warp(T0 + 2 * WINDOW);

        uint256 v2Alice = v2.claimableERC20(usdc, _idsOf(idAlice));
        uint256 v2Bob = v2.claimableERC20(usdc, _idsOf(idBob));
        assertGt(v2Alice, 0, "v2 erc20: alice accrues post-upgrade");
        assertEq(v2Alice, v2Bob, "v2 erc20: equal T1 weights accrue equally");
        assertLe(v2Alice + v2Bob, D6, "v2 erc20 conservation");
    }
}
