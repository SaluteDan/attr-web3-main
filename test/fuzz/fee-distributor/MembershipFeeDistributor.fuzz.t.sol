// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MembershipFeeDistributor} from "../../../contracts/MembershipFeeDistributor.sol";
import {MockMembershipToken} from "../../../contracts/mocks/MockMembershipToken.sol";
import {MockFeeUSDC, MockFeeOnTransferERC20} from "../../../contracts/mocks/MockFeeTokens.sol";
import "../../../contracts/Errors.sol";

/// @notice ERC-721-receiver-capable ETH payee used for all holdings/claims.
contract QActor {
    uint256 public received;
    receive() external payable {
        received += msg.value;
    }
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

/**
 * @title MembershipFeeDistributorFuzzTest
 * @notice Functional half of the tier-weighted distributor suite.
 *
 * Exact model under test:
 *   W          = 225*nT1 + 100*nT2      (live, recomputed)
 *   T1 share   = pool * 225 / W
 *   T2 share   = pool * 100 / W
 *   pool       = D - (D % W)            (residue carried forward)
 *   T1 / T2    = exactly 2.25x per identical deposit, any supply mix
 *
 * Accrual is over continuous holding intervals (`WINDOW`), so a claimant that
 * holds a fraction `dt / WINDOW` captures that fraction of its weighted share.
 */
contract MembershipFeeDistributorFuzzTest is Test {
    MembershipFeeDistributor internal dist;
    MockMembershipToken internal membership;
    MockFeeUSDC internal usdc;

    address internal dao = address(0xDA0);
    QActor internal userC;
    QActor internal secondC;
    address internal user;
    address internal second;

    uint256 internal constant WINDOW = 1 days;
    uint256 internal constant D = 1_000 ether;

    function setUp() public {
        membership = new MockMembershipToken("ATTR-MEMBER-ID", "ATTR#");
        dist = new MembershipFeeDistributor(address(membership), dao);
        usdc = new MockFeeUSDC();
        vm.deal(dao, 1_000_000 ether);
        userC = new QActor();
        secondC = new QActor();
        user = address(userC);
        second = address(secondC);
        vm.deal(user, 1 ether);
        vm.deal(second, 1 ether);
        vm.prank(dao);
        dist.setTotalMintedSnapshot(type(uint256).max);
        vm.warp(1_700_000_000);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _deposit(uint256 amount) internal {
        vm.prank(dao);
        dist.depositETH{value: amount}();
    }

    function _allIds(uint256 n) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            ids[i] = i;
        }
    }

    function _idsOf(uint256 a) internal pure returns (uint256[] memory out) {
        out = new uint256[](1);
        out[0] = a;
    }

    /// @notice The interval pool for a deposit D against weighted supply W.
    function _pool(uint256 amount, uint256 W) internal pure returns (uint256) {
        return amount - (amount % W);
    }

    // ── (2) tier-weight correctness ───────────────────────────────────────────

    /// @notice Parameterised grid nT1 = 0..10 x nT2 = 0..10: the weighted shares are
    ///         exact (within one wei of integer truncation) for every supply mix.
    function testGrid_TierRatioAcrossSupplyMix() public {
        for (uint256 nT1 = 0; nT1 <= 10; ++nT1) {
            for (uint256 nT2 = 0; nT2 <= 10; ++nT2) {
                if (nT1 + nT2 == 0) continue;
                MockMembershipToken m = new MockMembershipToken("A", "A");
                MembershipFeeDistributor d = new MembershipFeeDistributor(address(m), dao);
                vm.prank(dao);
                d.setTotalMintedSnapshot(type(uint256).max);
                m.mintMany(user, nT1, nT2);
                vm.prank(dao);
                d.depositETH{value: D}();
                vm.warp(block.timestamp + WINDOW);

                uint256 W = 225 * nT1 + 100 * nT2;
                uint256 pool = _pool(D, W);
                if (nT1 > 0) {
                    assertApproxEqAbs(d.claimableETH(_idsOf(0)), (pool * 225) / W, 1, "T1 share");
                }
                if (nT2 > 0) {
                    assertApproxEqAbs(d.claimableETH(_idsOf(nT1)), (pool * 100) / W, 1, "T2 share");
                }
                uint256 sum = d.claimableETH(_allIds(nT1 + nT2));
                assertLe(sum, D, "sum of shares never exceeds the deposit");
            }
        }
    }

    /// @notice 2.25:1 invariant holds for random supply mixes and random deposits.
    function testFuzz_ExactRatio_2_25(uint96 amount, uint8 nT1, uint8 nT2) public {
        amount = uint96(bound(amount, 1e12, 1_000 ether));
        nT1 = uint8(bound(nT1, 1, 20));
        nT2 = uint8(bound(nT2, 1, 20));

        membership.mintMany(user, nT1, nT2);
        _deposit(amount);
        vm.warp(block.timestamp + WINDOW);

        uint256 dueT1 = dist.claimableETH(_idsOf(0));
        uint256 dueT2 = dist.claimableETH(_idsOf(nT1));
        assertGt(dueT2, 0, "T2 must accrue");
        assertApproxEqAbs(dueT1 * 100, dueT2 * 225, 225, "T1 == 2.25x T2");
    }

    /// @notice T0 weights exactly zero and is never payable.
    function test_TierZeroReceivesNothing() public {
        uint256 id = membership.mint(user, 1);
        membership.mint(second, 1); // keeps W = 225 while `id` is relabelled to T0
        membership.updateTier(id, 0);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);
        assertEq(dist.claimableETH(_idsOf(id)), 0, "T0 accrues nothing");
        vm.prank(user);
        vm.expectRevert(NothingToClaim.selector);
        dist.claimETH(_idsOf(id));
    }

    /// @notice Multiple deposits accumulate under a supply mix that changes between them.
    function test_MultiDepositAccumulationUnderChangingSupply() public {
        membership.mintMany(user, 1, 1); // W = 325
        _deposit(D);
        membership.mintMany(user, 0, 2); // supply grows before the second deposit
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);

        // The interval pool is D - (D % W); the token's share divides by the live W.
        uint256 p1 = _pool(D, 325);
        uint256 p2 = _pool(D, 525);
        // The live W is 525 at claim, so both pools are split over W = 525.
        uint256 expected = (p1 * 225) / 525 + (p2 * 225) / 525;
        assertApproxEqAbs(dist.claimableETH(_idsOf(0)), expected, 500, "multi-deposit accumulation");
    }

    // ── (3) normalisation / solvency ──────────────────────────────────────────

    /// @notice Σ claimable + dust never exceeds what was deposited, at any supply.
    function testFuzz_NoOverCommitment(uint96 amount, uint8 nT1, uint8 nT2) public {
        amount = uint96(bound(amount, 1, 500 ether));
        nT1 = uint8(bound(nT1, 0, 15));
        nT2 = uint8(bound(nT2, 0, 15));
        vm.assume(nT1 + nT2 > 0);

        membership.mintMany(user, nT1, nT2);
        _deposit(amount);
        vm.warp(block.timestamp + WINDOW);

        uint256 sum = dist.claimableETH(_allIds(nT1 + nT2));
        assertLe(sum, uint256(amount), "total claimable <= deposited");
        assertLe(sum, address(dist).balance, "total claimable <= contract balance");
    }

    /// @notice Weights are live: a tier upgrade between deposit and claim is honoured.
    function test_LiveWeights_NotFrozen() public {
        uint256 a = membership.mint(user, 2);
        uint256 b = membership.mint(second, 2); // W = 200 at deposit
        _deposit(D);
        membership.updateTier(a, 1); // a is now T1, read live at claim
        vm.warp(block.timestamp + WINDOW);
        uint256 dueA = dist.claimableETH(_idsOf(a));
        uint256 dueB = dist.claimableETH(_idsOf(b));
        assertGt(dueA, dueB, "the upgraded token earns more (live tier honoured)");
        assertLe(dueA + dueB, D, "shares never exceed the deposit");
    }

    // ── (4) tier timing ───────────────────────────────────────────────────────

    /// @notice Tier is sampled at claim time; a pre-claim change affects the payout.
    function test_TierSampledAtClaimTime() public {
        uint256 id = membership.mint(user, 2);
        uint256 peer = membership.mint(second, 2); // W = 200 pre-upgrade
        _deposit(D);
        membership.updateTier(id, 1); // T2 -> T1 before claim
        vm.warp(block.timestamp + WINDOW);
        uint256 due = dist.claimableETH(_idsOf(id));
        uint256 duePeer = dist.claimableETH(_idsOf(peer));
        assertGt(due, duePeer, "claim uses the tier active at claim time");
    }

    /// @notice A post-claim tier change is not retroactive.
    function test_PostClaimChangeNotRetroactive() public {
        uint256 id = membership.mint(user, 2);
        membership.mint(second, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);
        uint256 dueBefore = dist.claimableETH(_idsOf(id));
        uint256 balBefore = user.balance;
        vm.prank(user);
        dist.claimETH(_idsOf(id));
        uint256 paid = user.balance - balBefore;
        assertEq(paid, dueBefore, "paid at the tier active at claim");
        membership.updateTier(id, 1);
        assertLe(dist.claimableETH(_idsOf(id)), 1, "no retroactive re-pricing");
    }

    // ── (5) dust / rounding ───────────────────────────────────────────────────

    /// @notice Integer division dust is never paid out; rounding favours the contract.
    function testFuzz_RoundingFavoursContract(uint96 amount, uint8 nT1) public {
        amount = uint96(bound(amount, 1, 1_000 ether));
        nT1 = uint8(bound(nT1, 1, 10));
        membership.mintMany(user, nT1, 0);
        _deposit(amount);
        vm.warp(block.timestamp + WINDOW);
        uint256 sum = dist.claimableETH(_allIds(nT1));
        assertLe(sum, uint256(amount), "contract never over-pays");
        assertGe(dist.ethDust(), 0, "dust accounted");
    }

    /// @notice Dust accumulates across many deposits without permanent loss.
    function test_DustAccumulationOverManyDeposits() public {
        membership.mintMany(user, 3, 2); // W = 875
        for (uint256 i = 0; i < 1000; ++i) {
            _deposit(0.001 ether);
        }
        vm.warp(block.timestamp + WINDOW);
        uint256 sum = dist.claimableETH(_allIds(5));
        assertLe(sum, 1 ether, "sum of claims <= total deposited");
        assertLe(sum, address(dist).balance, "claims covered by balance");
    }

    // ── (6) claim paths ───────────────────────────────────────────────────────

    /// @notice Mixed-tier batch claim pays exactly the summed weighted shares.
    function test_BatchMixedTierClaim() public {
        membership.mintMany(user, 2, 3); // W = 750
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);
        uint256 due = dist.claimableETH(_allIds(5));
        uint256 balBefore = user.balance;
        vm.prank(user);
        dist.claimETH(_allIds(5));
        uint256 paid = user.balance - balBefore;
        assertEq(paid, due, "batch pays the summed shares");
        assertEq(dist.claimableETH(_allIds(5)), 0, "batch clears pending");
    }

    /// @notice Gas benchmark: batch of 10 tokens stays under 150k gas per token.
    function test_Gas_BatchOfTenUnder150kPerToken() public {
        membership.mintMany(user, 5, 5); // W = 1625
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);
        uint256[] memory ids = _allIds(10);
        uint256 before = gasleft();
        vm.prank(user);
        dist.claimETH(ids);
        uint256 used = before - gasleft();
        assertLt(used, 150_000 * 10, "batch of 10 under 150k gas per token");
    }

    // ── (7) migration & snapshot semantics ────────────────────────────────────

    /// @notice A zero gate blocks deposits; a non-zero gate merely opens the door and
    ///         the divisor is ALWAYS the live weighted supply.
    function test_SnapshotIsGateOnly_DivisorIsLive() public {
        MockMembershipToken m = new MockMembershipToken("A", "A");
        MembershipFeeDistributor d = new MembershipFeeDistributor(address(m), dao);
        m.mintMany(user, 1, 1); // W = 325

        vm.prank(dao);
        vm.expectRevert(InvalidMaxSupply.selector);
        d.depositETH{value: 1 ether}();

        // A deliberately wrong gate (1) does not change the divisor.
        vm.prank(dao);
        d.setTotalMintedSnapshot(1);
        vm.prank(dao);
        d.depositETH{value: 1 ether}();
        assertEq(d.ethPricePerWeight(), uint256(1 ether) - (uint256(1 ether) % 325), "pool = D - residue");
    }

    // ── (8) events & views ────────────────────────────────────────────────────

    /// @notice claimable views report the exact weighted pending amount.
    function test_ClaimableViewsExactWeightedPending() public {
        membership.mintMany(user, 1, 3); // W = 525
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);
        uint256 pool = _pool(D, 525);
        assertApproxEqAbs(dist.claimableETH(_idsOf(0)), (pool * 225) / 525, 300, "T1 pending exact");
        assertApproxEqAbs(dist.claimableETH(_idsOf(1)), (pool * 100) / 525, 300, "T2 pending exact");
    }

    /// @notice ethDust is readable and bounded by the live weighted supply.
    function test_EthDustReadableAndNonIncreasingOnDeposit() public {
        membership.mintMany(user, 2, 1); // W = 550
        _deposit(1 ether);
        assertLt(dist.ethDust(), 550, "dust is the residue mod W");
        _deposit(1 ether);
        assertLe(dist.ethDust(), 550, "dust stays bounded by W");
    }

    // ── (9) ERC20 path ────────────────────────────────────────────────────────

    /// @notice ERC-20 claims follow the identical weighting and conservation rules.
    function test_ERC20WeightedDistribution() public {
        membership.mintMany(user, 2, 2); // W = 650
        uint256 amount = 1_000e6;
        usdc.mint(dao, amount);
        vm.startPrank(dao);
        usdc.approve(address(dist), amount);
        dist.depositERC20(usdc, amount);
        vm.stopPrank();
        vm.warp(block.timestamp + WINDOW);

        uint256 pool = amount - (amount % 650);
        assertApproxEqAbs(dist.claimableERC20(usdc, _idsOf(0)), (pool * 225) / 650, 300, "T1 ERC20 share");
        assertApproxEqAbs(dist.claimableERC20(usdc, _idsOf(2)), (pool * 100) / 650, 300, "T2 ERC20 share");

        uint256 balBefore = usdc.balanceOf(user);
        vm.prank(user);
        dist.claimERC20(usdc, _allIds(4));
        uint256 paid = usdc.balanceOf(user) - balBefore;
        assertLe(paid, amount, "ERC20 payouts never exceed the deposit");
        assertEq(usdc.balanceOf(address(dist)), amount - paid, "residue stays in the contract");
    }

    /// @notice Fee-on-transfer tokens credit the received delta, not the nominal amount.
    function test_ERC20UsesReceivedDelta() public {
        membership.mintMany(user, 4, 0); // W = 900
        MockFeeOnTransferERC20 fee = new MockFeeOnTransferERC20(500); // 5%
        fee.mint(dao, 1_000e6);
        vm.startPrank(dao);
        fee.approve(address(dist), 1_000e6);
        dist.depositERC20(fee, 1_000e6);
        vm.stopPrank();
        assertEq(fee.balanceOf(address(dist)), 950e6, "credited the delivered delta");
        // The interval pool excludes the carried residue (950e6 % 900).
        assertEq(dist.erc20PricePerWeight(fee), uint256(950e6) - (uint256(950e6) % 900), "pool = delta - residue");
    }
}
