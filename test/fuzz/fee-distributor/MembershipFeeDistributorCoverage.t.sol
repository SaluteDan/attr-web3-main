// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MembershipFeeDistributor} from "../../../contracts/MembershipFeeDistributor.sol";
import {MockMembershipToken} from "../../../contracts/mocks/MockMembershipToken.sol";
import {MockFeeUSDC} from "../../../contracts/mocks/MockFeeTokens.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../../contracts/Errors.sol";

/// @notice ERC-721-receiver-capable ETH payee (real receive body).
contract CovActor {
    uint256 public received;
    receive() external payable {
        received += msg.value;
    }
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}

/// @notice Payee whose `receive` ALWAYS reverts, to exercise `TransferFailed`.
contract RejectingPayee {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
    receive() external payable {
        revert("no eth");
    }
}

/**
 * @title MembershipFeeDistributorCoverageTest
 * @notice Targeted tests that exercise the admin/keeper/dust/view surface that the
 *         functional, C-1, security and migration suites do not touch, to lift
 *         statement + branch coverage of `MembershipFeeDistributor.sol` toward the
 *         ratified >=95% statement / 100% branch target.
 *
 * @dev No contract logic is changed here. Every assertion pins the documented
 *      behaviour of the existing implementation.
 */
contract MembershipFeeDistributorCoverageTest is Test {
    MembershipFeeDistributor internal dist;
    MockMembershipToken internal membership;
    MockFeeUSDC internal usdc;

    address internal dao = address(0xDA0);
    CovActor internal aliceC;
    CovActor internal bobC;
    CovActor internal carolC;
    address internal alice;
    address internal bob;
    address internal carol;

    uint256 internal constant WINDOW = 1 days;
    uint256 internal constant D = 1_000 ether;

    function setUp() public {
        membership = new MockMembershipToken("ATTR-MEMBER-ID", "ATTR#");
        dist = new MembershipFeeDistributor(address(membership), dao);
        usdc = new MockFeeUSDC();
        membership.setFeeDistributor(address(dist));
        vm.deal(dao, 1_000_000 ether);
        aliceC = new CovActor();
        bobC = new CovActor();
        carolC = new CovActor();
        alice = address(aliceC);
        bob = address(bobC);
        carol = address(carolC);
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
        vm.deal(carol, 1 ether);
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

    function _depositERC20(uint256 amount) internal {
        usdc.mint(dao, amount);
        vm.startPrank(dao);
        usdc.approve(address(dist), amount);
        dist.depositERC20(usdc, amount);
        vm.stopPrank();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Constructor guards
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice The constructor zero-address guard for the membership token reverts
    ///         ZeroAddress (line 221). The `daoOwner == address(0)` guard (line
    ///         222) is UNREACHABLE because Ownable's constructor runs first and
    ///         reverts `OwnableInvalidOwner`; documented here rather than fixed
    ///         (no contract changes per lane scope).
    function test_ConstructorRejectsZeroAddresses() public {
        vm.expectRevert(ZeroAddress.selector);
        new MembershipFeeDistributor(address(0), dao);

        // Observed: Ownable's `Ownable(address(0))` reverts before the contract's
        // own ZeroAddress guard can run.
        vm.expectRevert(abi.encodeWithSignature("OwnableInvalidOwner(address)", address(0)));
        new MembershipFeeDistributor(address(membership), address(0));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Keeper / dust-threshold admin (lines 244-246, 252-254)
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice setKeeper / setDustThreshold update state and emit the right events.
    function test_SetKeeperAndDustThreshold() public {
        vm.expectEmit(true, true, true, true);
        emit MembershipFeeDistributor.KeeperUpdated(address(0), carol);
        vm.prank(dao);
        dist.setKeeper(carol);
        assertEq(dist.keeper(), carol, "keeper updated");

        vm.expectEmit(true, true, true, true);
        emit MembershipFeeDistributor.KeeperUpdated(carol, address(0));
        vm.prank(dao);
        dist.setKeeper(address(0));
        assertEq(dist.keeper(), address(0), "keeper cleared");

        vm.expectEmit(true, true, true, true);
        emit MembershipFeeDistributor.DustThresholdUpdated(address(usdc), 0, 7e6);
        vm.prank(dao);
        dist.setDustThreshold(address(usdc), 7e6);
        assertEq(dist.dustThreshold(address(usdc)), 7e6, "threshold set");

        vm.expectEmit(true, true, true, true);
        emit MembershipFeeDistributor.DustThresholdUpdated(address(usdc), 7e6, 9e6);
        vm.prank(dao);
        dist.setDustThreshold(address(usdc), 9e6);
        assertEq(dist.dustThreshold(address(usdc)), 9e6, "threshold overwritten");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // depositERC20 guards (lines 296, 299, 304)
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice depositERC20 with token == address(0) reverts ZeroAddress.
    function test_DepositERC20RejectsZeroToken() public {
        membership.mint(alice, 1);
        vm.prank(dao);
        vm.expectRevert(ZeroAddress.selector);
        dist.depositERC20(IERC20(address(0)), 1);
    }

    /// @notice depositERC20 while the gate is closed reverts InvalidMaxSupply.
    function test_DepositERC20GateClosedReverts() public {
        // Fresh distributor: gate starts at 0.
        MembershipFeeDistributor d2 = new MembershipFeeDistributor(address(membership), dao);
        membership.mint(alice, 1);
        usdc.mint(dao, 100e6);
        vm.startPrank(dao);
        usdc.approve(address(d2), 100e6);
        vm.expectRevert(InvalidMaxSupply.selector);
        d2.depositERC20(usdc, 100e6);
        vm.stopPrank();
    }

    /// @notice depositERC20 that receives zero delta (nominal amount credited 0)
    ///         reverts ZeroDeposit — exercised via a token that delivers nothing.
    function test_DepositERC20ZeroReceivedReverts() public {
        membership.mint(alice, 1);
        ZeroDeliveryToken z = new ZeroDeliveryToken();
        z.mint(dao, 1_000e6);
        vm.startPrank(dao);
        z.approve(address(dist), 1_000e6);
        // The mock delivers nothing on transferFrom, so `received == 0`.
        vm.expectRevert(ZeroDeposit.selector);
        dist.depositERC20(z, 1_000e6);
        vm.stopPrank();
    }

    // ══════════════════════════════════════════════════════════════════════════
    // checkpoint (lines 366, 370, 372-377)
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice checkpoint reverts when called by anyone but the membership token
    ///         (line 366).
    function test_CheckpointUnauthorizedReverts() public {
        membership.mint(alice, 1);
        vm.prank(bob);
        vm.expectRevert(Unauthorized.selector);
        dist.checkpoint(0, alice, bob);
    }

    /// @notice A mint (from == 0) and a self-transfer (from == to) are no-ops in
    ///         checkpoint (line 370). Exercised through the real token hook, plus a
    ///         direct call impersonating the token to cover both early-return arms.
    function test_CheckpointEarlyReturns() public {
        uint256 id = membership.mint(alice, 1); // mint path: from == 0 -> return
        _deposit(D);

        // Direct call as the membership token mimics the mint branch (from == 0).
        vm.prank(address(membership));
        dist.checkpoint(id, address(0), alice); // returns silently

        // Self-transfer branch (from == to).
        vm.prank(address(membership));
        dist.checkpoint(id, alice, alice); // returns silently

        // A real transfer settles and emits (lines 372-377).
        uint256 balBefore = dist.pendingClaim(address(0), alice);
        vm.warp(block.timestamp + WINDOW / 2);
        vm.prank(alice);
        membership.transferFrom(alice, bob, id);
        assertGt(dist.pendingClaim(address(0), alice), balBefore, "real transfer settles the seller");
    }

    /// @notice A real transfer emits AccrualCheckpointed with the settled total.
    function test_CheckpointEmits() public {
        uint256 id = membership.mint(alice, 1);
        _deposit(D);
        // Also seed an ERC-20 currency so the multi-currency loop runs >1 iteration.
        _depositERC20(D);
        vm.warp(block.timestamp + WINDOW / 2);

        vm.expectEmit(true, true, true, false);
        emit MembershipFeeDistributor.AccrualCheckpointed(id, alice, bob, 0);
        vm.prank(alice);
        membership.transferFrom(alice, bob, id);
        assertGt(dist.pendingClaim(address(0), alice), 0, "ETH settled");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // claimPendingETH / claimPendingERC20 (lines 433-451)
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice `claimPendingETH` drains a settled balance with no held ids and
    ///         reverts NothingToClaim when the balance is zero.
    function test_ClaimPendingETH() public {
        uint256 id = membership.mint(alice, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        membership.transferFrom(alice, bob, id); // settle alice into her pending balance

        uint256 pending = dist.pendingClaim(address(0), alice);
        assertGt(pending, 0, "settled balance exists");

        uint256 before = alice.balance;
        vm.prank(alice);
        dist.claimPendingETH();
        assertEq(alice.balance - before, pending, "pending ETH fully drained");
        assertEq(dist.pendingClaim(address(0), alice), 0, "balance zeroed");
        assertEq(dist.totalClaimedETH(), pending, "claimed ledger updated");

        vm.prank(alice);
        vm.expectRevert(NothingToClaim.selector);
        dist.claimPendingETH();
    }

    /// @notice `claimPendingERC20` drains a settled ERC-20 balance; zero token
    ///         reverts ZeroAddress and an empty balance reverts NothingToClaim.
    function test_ClaimPendingERC20() public {
        uint256 id = membership.mint(alice, 1);
        _depositERC20(D);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        membership.transferFrom(alice, bob, id); // settle into alice's pending ERC-20

        uint256 pending = dist.pendingClaim(address(usdc), alice);
        assertGt(pending, 0, "settled ERC-20 balance exists");

        vm.prank(alice);
        vm.expectRevert(ZeroAddress.selector);
        dist.claimPendingERC20(IERC20(address(0)));

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        dist.claimPendingERC20(usdc);
        assertEq(usdc.balanceOf(alice) - before, pending, "pending ERC-20 fully drained");
        assertEq(dist.totalClaimedERC20(usdc), pending, "claimed ledger updated");

        vm.prank(alice);
        vm.expectRevert(NothingToClaim.selector);
        dist.claimPendingERC20(usdc);
    }

    /// @notice `claimETH` reverting receiver propagates TransferFailed (line 401).
    function test_ClaimETH_TransferFailure() public {
        RejectingPayee rej = new RejectingPayee();
        uint256 id = membership.mint(address(rej), 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);

        vm.prank(address(rej));
        vm.expectRevert(TransferFailed.selector);
        dist.claimETH(_one(id));
    }

    /// @notice `claimERC20` with token == address(0) reverts ZeroAddress (line 413).
    function test_ClaimERC20_ZeroTokenReverts() public {
        uint256 id = membership.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(ZeroAddress.selector);
        dist.claimERC20(IERC20(address(0)), _one(id));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Remaining branch coverage (constructor guards, empty-array guards,
    // deposit-ETH zero guard, claimPendingETH transfer failure, frozen else-arm)
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Constructor: both `address(0)` argument guards are exercised.
    /// @dev `membershipToken_ == 0` reverts the contract's own ZeroAddress
    ///      (line 221); `daoOwner == 0` is shadowed by `Ownable(address(0))`
    ///      which reverts first (line 222's ZeroAddress branch is unreachable
    ///      given the `Ownable(daoOwner)` base call).
    function test_ConstructorBranches() public {
        vm.expectRevert(ZeroAddress.selector);
        new MembershipFeeDistributor(address(0), dao);

        vm.expectRevert(abi.encodeWithSignature("OwnableInvalidOwner(address)", address(0)));
        new MembershipFeeDistributor(address(membership), address(0));
    }

    /// @notice depositETH with zero value reverts ZeroDeposit (line 264 branch).
    function test_DepositETH_ZeroValueReverts() public {
        membership.mint(alice, 1);
        vm.prank(dao);
        vm.expectRevert(ZeroDeposit.selector);
        dist.depositETH{value: 0}();
    }

    /// @notice claimETH / claimERC20 with an empty id array revert NoTokenIds
    ///         (lines 389 and 415 branches), before any ownership check.
    function test_ClaimEmptyArraysRevert() public {
        uint256[] memory empty = new uint256[](0);
        vm.prank(alice);
        vm.expectRevert(NoTokenIds.selector);
        dist.claimETH(empty);

        vm.prank(alice);
        vm.expectRevert(NoTokenIds.selector);
        dist.claimERC20(usdc, empty);
    }

    /// @notice claimPendingETH with a reverting receiver propagates TransferFailed
    ///         (line 438 branch: the transfer-failure revert on the pending path).
    function test_ClaimPendingETH_TransferFailure() public {
        RejectingPayee rej = new RejectingPayee();
        uint256 id = membership.mint(address(rej), 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(address(rej));
        membership.transferFrom(address(rej), bob, id); // settle rej's pending ETH

        vm.prank(address(rej));
        vm.expectRevert(TransferFailed.selector);
        dist.claimPendingETH();
    }

    /// @notice `_frozenWeight` else-arm (line 651): a token absent from the open
    ///         interval's frozen set is stored with weight 0 and gets the current
    ///         interval stamp. Exercised by settling a mid-interval mint through a
    ///         real transfer (checkpoint -> _settleTo -> _frozenWeight).
    function test_FrozenWeightElseArmWrite() public {
        uint256 aliceId = membership.mint(alice, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW / 2);
        uint256 bobId = membership.mint(bob, 1); // NOT in the frozen set (minted after deposit)

        // Transfer the mid-interval mint: the outgoing-holder checkpoint calls
        // `_frozenWeight`, which takes the else-arm (weight 0) for this token.
        vm.prank(bob);
        membership.transferFrom(bob, carol, bobId);

        assertEq(dist.claimableETH(_one(bobId)), 0, "non-enrolled token accrues nothing this interval");
        assertGt(dist.claimableETH(_one(aliceId)), 0, "interval member still accrues");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // pushRewards / pushRewardsERC20 guards + both branches (lines 463-477, 758-769)
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice pushRewards: unauthorized when keeper unset; ZeroAddress for holder.
    function test_PushRewardsGuards() public {
        vm.prank(bob);
        vm.expectRevert(Unauthorized.selector);
        dist.pushRewards(alice); // keeper == 0

        vm.prank(dao);
        dist.setKeeper(carol);
        vm.prank(bob);
        vm.expectRevert(Unauthorized.selector);
        dist.pushRewards(alice); // caller != keeper

        vm.prank(carol);
        vm.expectRevert(ZeroAddress.selector);
        dist.pushRewards(address(0));
    }

    /// @notice pushRewardsERC20: same guards plus ZeroAddress for the token.
    function test_PushRewardsERC20Guards() public {
        vm.prank(bob);
        vm.expectRevert(Unauthorized.selector);
        dist.pushRewardsERC20(usdc, alice);

        vm.prank(dao);
        dist.setKeeper(carol);
        vm.prank(bob);
        vm.expectRevert(Unauthorized.selector);
        dist.pushRewardsERC20(usdc, alice);

        vm.prank(carol);
        vm.expectRevert(ZeroAddress.selector);
        dist.pushRewardsERC20(IERC20(address(0)), alice);

        vm.prank(carol);
        vm.expectRevert(ZeroAddress.selector);
        dist.pushRewardsERC20(usdc, address(0));
    }

    /// @notice Keeper push of an ETH balance above the threshold (lines 761-765).
    function test_PushRewardsETH_Success() public {
        uint256 id = membership.mint(alice, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        membership.transferFrom(alice, bob, id); // settle alice

        vm.prank(dao);
        dist.setKeeper(carol);
        vm.prank(dao);
        dist.setDustThreshold(address(0), 1); // tiny threshold

        uint256 pending = dist.pendingClaim(address(0), alice);
        uint256 before = alice.balance;
        vm.prank(carol);
        dist.pushRewards(alice);
        assertEq(alice.balance - before, pending, "keeper push moves the accrued ETH");
        assertEq(dist.pendingClaim(address(0), alice), 0, "balance zeroed");
    }

    /// @notice Keeper push of an ERC-20 balance above the threshold (lines 766-769).
    function test_PushRewardsERC20_Success() public {
        uint256 id = membership.mint(alice, 1);
        _depositERC20(D);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(alice);
        membership.transferFrom(alice, bob, id); // settle alice

        vm.prank(dao);
        dist.setKeeper(carol);
        vm.prank(dao);
        dist.setDustThreshold(address(usdc), 1);

        uint256 pending = dist.pendingClaim(address(usdc), alice);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(carol);
        dist.pushRewardsERC20(usdc, alice);
        assertEq(usdc.balanceOf(alice) - before, pending, "keeper push moves the accrued ERC-20");
        assertEq(dist.pendingClaim(address(usdc), alice), 0, "balance zeroed");
    }

    /// @notice Push reverting receiver on the ETH branch propagates TransferFailed.
    function test_PushRewardsETH_TransferFailure() public {
        RejectingPayee rej = new RejectingPayee();
        uint256 id = membership.mint(address(rej), 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(address(rej));
        membership.transferFrom(address(rej), bob, id); // settle rej's pending ETH

        vm.prank(dao);
        dist.setKeeper(carol);
        vm.prank(dao);
        dist.setDustThreshold(address(0), 1);

        vm.prank(carol);
        vm.expectRevert(TransferFailed.selector);
        dist.pushRewards(address(rej));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // sweepDustETH / sweepDustERC20 (lines 489-507, 775-777)
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Dust salvage is currently UNREACHABLE: `_sweepable()` reads
    ///         `total` (ethDust) and `fresh` (_energy[t].dust), but both are always
    ///         written to the same `newDust` on every deposit, so `total == fresh`
    ///         and `_sweepable()` returns 0. This test pins the OBSERVED behaviour
    ///         and covers the sweep revert branch; it does NOT assert a working
    ///         sweep, because that would require a contract change (out of scope).
    ///         FINDING: sweepDustETH / sweepDustERC20 always revert NothingToClaim.
    function test_SweepDustETH_Flow() public {
        membership.mint(alice, 2); // W = 100
        uint256 amount = 1_000 ether + 7; // residue = 7
        _deposit(amount);
        assertEq(dist.ethDust(), 7, "residue created");
        assertEq(dist.pendingDustETH(), dist.ethDust(), "stored and open-interval dust agree");

        // Current-interval residue is not sweepable.
        vm.prank(dao);
        vm.expectRevert(NothingToClaim.selector);
        dist.sweepDustETH();

        // A second deposit folds the previous residue back into the pool but
        // re-writes BOTH dust slots to the same new residue, so nothing is ever
        // releasable. Document the observed non-reachability.
        _deposit(1_000 ether);
        assertEq(dist.ethDust(), dist.pendingDustETH(), "dust slots stay in lockstep");
        vm.prank(dao);
        vm.expectRevert(NothingToClaim.selector);
        dist.sweepDustETH();
    }

    /// @notice ERC-20 twin of the dust-salvage finding (see test_SweepDustETH_Flow).
    function test_SweepDustERC20_Flow() public {
        membership.mint(alice, 2); // W = 100
        uint256 amount = 1_000e6 + 7; // residue = 7
        _depositERC20(amount);
        assertEq(dist.erc20Dust(usdc), 7, "ERC-20 residue created");
        assertEq(dist.pendingDustERC20(usdc), dist.erc20Dust(usdc), "dust slots agree");

        vm.prank(dao);
        vm.expectRevert(NothingToClaim.selector);
        dist.sweepDustERC20(usdc); // open-interval residue is not releasable

        // Second deposit re-writes both dust slots identically -> still unreachable.
        _depositERC20(1_000e6);
        assertEq(dist.erc20Dust(usdc), dist.pendingDustERC20(usdc), "dust slots stay in lockstep");
        vm.prank(dao);
        vm.expectRevert(NothingToClaim.selector);
        dist.sweepDustERC20(usdc);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Reentrancy probes (lines 514, 519)
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Both probes succeed (and bump their counters) when no guard is live.
    function test_ReentrancyProbesSucceedOutsideGuard() public {
        dist.probeETHReentrancy();
        dist.probeERC20Reentrancy();
        assertEq(dist.ethReentrancyReverted(), 1, "ETH probe counted");
        assertEq(dist.erc20ReentrancyReverted(), 1, "ERC-20 probe counted");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Views (lines 545, 550, 555, 560, 565, 570, 580, 585, 590, 597, 602, 607, 612)
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Every public view returns a value consistent with the open state.
    function test_ViewSurface() public {
        uint256 id = membership.mint(alice, 1); // W = 225
        assertEq(dist.currencyCount(), 1, "ETH registered at construction");

        _deposit(D);
        _depositERC20(D);

        assertEq(dist.currencyCount(), 2, "ERC-20 registered on deposit");
        assertEq(dist.pendingClaim(address(0), alice), 0, "no pending yet");
        assertEq(dist.ethCumReward(), 0, "cum reward starts at 0");
        assertEq(dist.erc20CumReward(usdc), 0, "ERC-20 cum reward starts at 0");
        assertEq(dist.ethIntervalWeight(), 225, "ETH frozen interval weight");
        assertEq(dist.erc20IntervalWeight(usdc), 225, "ERC-20 frozen interval weight");
        assertGt(dist.ethPricePerWeight(), 0, "ETH open pool");
        assertGt(dist.erc20PricePerWeight(usdc), 0, "ERC-20 open pool");
        assertEq(dist.totalClaimedETH(), 0, "no ETH claimed");
        assertEq(dist.totalClaimedERC20(usdc), 0, "no ERC-20 claimed");
        assertEq(dist.liveWeight(), 225, "live weight");
        assertEq(dist.pendingDustETH(), dist.ethDust(), "ETH view mirrors storage");
        assertEq(dist.pendingDustERC20(usdc), dist.erc20Dust(usdc), "ERC-20 view mirrors storage");

        // cumRewardAt before the interval start returns the finalised cumulative.
        uint256 cumAtBefore = dist.cumRewardAt(address(0), block.timestamp - 1);
        assertEq(cumAtBefore, dist.ethCumReward(), "cumAt clamps to cumReward before the interval");

        // cumRewardAt after the interval start includes the open interval.
        __burn(id); // remove the member so the view path is deterministic
        uint256 cumAtAfter = dist.cumRewardAt(address(0), block.timestamp + WINDOW / 2);
        assertGt(cumAtAfter, dist.ethCumReward(), "cumAt adds the open interval");
    }

    function __burn(uint256 id) internal {
        membership.burn(id);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Internal branches: _frozenWeight else-arm, _clampedWeight, _cumAt arms
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice A token minted mid-interval hits the `_frozenWeight` else-arm
    ///         (lines 649-651): weight 0 for the open interval.
    function test_FrozenWeightElseArm_MidIntervalMint() public {
        uint256 aliceId = membership.mint(alice, 1);
        _deposit(D);
        vm.warp(block.timestamp + WINDOW / 2);
        uint256 bobId = membership.mint(bob, 1); // minted AFTER the sweep

        // Bob is not in the frozen set for the open interval -> weight 0.
        assertEq(dist.claimableETH(_one(bobId)), 0, "mid-interval minter earns nothing this interval");
        // Alice is in the set and accrues.
        assertGt(dist.claimableETH(_one(aliceId)), 0, "interval member accrues");
    }

    /// @notice `cumRewardAt` with no open interval (zero weight / zero pool) and a
    ///         timestamp beyond the window both clamp correctly (lines 703-708).
    function test_CumAtBranches() public {
        // Before any deposit: no open interval -> returns cumReward (0).
        membership.mint(alice, 1);
        assertEq(dist.cumRewardAt(address(0), block.timestamp + WINDOW), 0, "no interval => cumReward");

        _deposit(D);
        // Beyond the window: elapsed clamps to WINDOW.
        uint256 atWindow = dist.cumRewardAt(address(0), block.timestamp + WINDOW);
        uint256 farFuture = dist.cumRewardAt(address(0), block.timestamp + 10 * WINDOW);
        assertEq(farFuture, atWindow, "elapsed clamps to WINDOW");
    }
}

/**
 * @title ZeroDeliveryToken
 * @notice ERC-20 whose `transferFrom` delivers nothing to the recipient (a
 *         pathological token), so the distributor credits a zero delta and must
 *         revert `ZeroDeposit`.
 */
contract ZeroDeliveryToken is IERC20 {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    function totalSupply() external pure override returns (uint256) {
        return 0;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        balanceOf[to] += amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        // Debits the sender's allowance but delivers nothing to `to`.
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        return true;
    }
}
