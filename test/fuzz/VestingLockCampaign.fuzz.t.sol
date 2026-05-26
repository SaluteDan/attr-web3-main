// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ATTRToken} from "../../contracts/ATTRToken.sol";
import {VestingLockCampaign} from "../../contracts/VestingLockCampaign.sol";
import {VestingLockCampaignFactory} from "../../contracts/VestingLockCampaignFactory.sol";

/**
 * @title VestingLockCampaign Fuzz Tests
 * @notice Property-based tests for reusable ATTR lock campaigns.
 */
contract VestingLockCampaignFuzzTest is Test {
    ATTRToken public attr;

    address public owner;
    address public treasury;
    address public alice;
    address public recipient;

    uint256 public constant CAP = 1_000_000_000e18;
    uint256 public constant INITIAL_MINT = 100_000_000e18;
    uint256 public constant MIN_LOCK = 2_500e18;
    uint256 public constant LOCK_PERIOD = 30 days;
    uint256 public constant REWARD = 5_000e18;
    uint256 public constant CAMPAIGN_DURATION = 14 days;

    function setUp() public {
        owner = makeAddr("owner");
        treasury = makeAddr("treasury");
        alice = makeAddr("alice");
        recipient = makeAddr("recipient");

        vm.prank(owner);
        attr = new ATTRToken(CAP, INITIAL_MINT, treasury);
    }

    function _campaign(bool allowEarlyWithdraw, uint256 maxParticipants)
        internal
        returns (VestingLockCampaign campaign)
    {
        VestingLockCampaign.CampaignConfig memory config = VestingLockCampaign.CampaignConfig({
            stakingToken: address(attr),
            allowEarlyWithdraw: allowEarlyWithdraw,
            rewardToken: address(attr),
            minLockAmount: MIN_LOCK,
            lockPeriod: LOCK_PERIOD,
            rewardAmount: REWARD,
            campaignStart: block.timestamp,
            campaignEnd: block.timestamp + CAMPAIGN_DURATION,
            maxParticipants: maxParticipants
        });

        campaign = new VestingLockCampaign(owner, config);
    }

    function _fundRewards(VestingLockCampaign campaign, uint256 amount) internal {
        vm.startPrank(treasury);
        attr.approve(address(campaign), amount);
        campaign.fundRewards(amount);
        vm.stopPrank();
    }

    function _fundAndApproveUser(VestingLockCampaign campaign, uint256 amount) internal {
        vm.startPrank(treasury);
        attr.transfer(alice, amount);
        vm.stopPrank();

        vm.startPrank(alice);
        attr.approve(address(campaign), amount);
        vm.stopPrank();
    }

    function _lock(VestingLockCampaign campaign, uint256 amount) internal {
        _fundAndApproveUser(campaign, amount);

        vm.prank(alice);
        campaign.lock(amount);
    }

    /**
     * @notice Fuzz: valid lock amounts create one position and preserve accounting.
     */
    function testFuzz_LockRecordsPositionAndTotals(uint256 amount) public {
        amount = bound(amount, MIN_LOCK, 1_000_000e18);
        VestingLockCampaign campaign = _campaign(false, 0);

        _lock(campaign, amount);

        VestingLockCampaign.Position memory position = campaign.getPosition(alice);
        assertTrue(position.exists, "position should exist");
        assertEq(position.amount, amount, "locked amount mismatch");
        assertEq(position.lockedAt, block.timestamp, "lockedAt mismatch");
        assertEq(campaign.participantCount(), 1, "participant count mismatch");
        assertEq(campaign.totalLocked(), amount, "total locked mismatch");
        assertEq(attr.balanceOf(address(campaign)), amount, "campaign balance mismatch");
    }

    /**
     * @notice Fuzz: lock amounts below the minimum always revert.
     */
    function testFuzz_LockBelowMinimumReverts(uint256 amount) public {
        amount = bound(amount, 0, MIN_LOCK - 1);
        VestingLockCampaign campaign = _campaign(false, 0);

        _fundAndApproveUser(campaign, amount);

        vm.prank(alice);
        vm.expectRevert();
        campaign.lock(amount);
    }

    /**
     * @notice Fuzz: rewards can only be claimed once the lock period has elapsed.
     */
    function testFuzz_ClaimAfterLockPeriodPaysReward(uint256 amount, uint256 secondsAfterPeriod) public {
        amount = bound(amount, MIN_LOCK, 1_000_000e18);
        secondsAfterPeriod = bound(secondsAfterPeriod, 0, 365 days);
        VestingLockCampaign campaign = _campaign(false, 0);

        _fundRewards(campaign, REWARD);
        _lock(campaign, amount);

        vm.warp(block.timestamp + LOCK_PERIOD + secondsAfterPeriod);

        uint256 aliceBefore = attr.balanceOf(alice);

        vm.prank(alice);
        campaign.claimReward();

        VestingLockCampaign.Position memory position = campaign.getPosition(alice);
        assertTrue(position.rewardClaimed, "reward claimed flag mismatch");
        assertEq(campaign.rewardsClaimedCount(), 1, "claimed count mismatch");
        assertEq(campaign.totalRewardsClaimed(), REWARD, "claimed total mismatch");
        assertEq(attr.balanceOf(alice), aliceBefore + REWARD, "reward transfer mismatch");
    }

    /**
     * @notice Fuzz: reward and principal can be claimed together after the lock period.
     */
    function testFuzz_ClaimRewardAndWithdrawPaysRewardAndPrincipal(uint256 amount, uint256 secondsAfterPeriod) public {
        amount = bound(amount, MIN_LOCK, 1_000_000e18);
        secondsAfterPeriod = bound(secondsAfterPeriod, 0, 365 days);
        VestingLockCampaign campaign = _campaign(false, 0);

        _fundRewards(campaign, REWARD);
        _lock(campaign, amount);

        vm.warp(block.timestamp + LOCK_PERIOD + secondsAfterPeriod);

        uint256 aliceBefore = attr.balanceOf(alice);

        vm.prank(alice);
        campaign.claimRewardAndWithdraw();

        VestingLockCampaign.Position memory position = campaign.getPosition(alice);
        assertTrue(position.rewardClaimed, "reward claimed flag mismatch");
        assertTrue(position.withdrawn, "withdrawn flag mismatch");
        assertEq(campaign.rewardsClaimedCount(), 1, "claimed count mismatch");
        assertEq(campaign.totalRewardsClaimed(), REWARD, "claimed total mismatch");
        assertEq(campaign.totalWithdrawn(), amount, "withdrawn total mismatch");
        assertEq(attr.balanceOf(alice), aliceBefore + REWARD + amount, "combined transfer mismatch");
    }

    /**
     * @notice Fuzz: early withdrawal either reverts or forfeits rewards based on campaign config.
     */
    function testFuzz_EarlyWithdrawBehavior(bool allowEarlyWithdraw, uint256 amount, uint256 elapsed) public {
        amount = bound(amount, MIN_LOCK, 1_000_000e18);
        elapsed = bound(elapsed, 0, LOCK_PERIOD - 1);
        VestingLockCampaign campaign = _campaign(allowEarlyWithdraw, 0);

        _fundRewards(campaign, REWARD);
        _lock(campaign, amount);

        vm.warp(block.timestamp + elapsed);

        if (!allowEarlyWithdraw) {
            vm.prank(alice);
            vm.expectRevert();
            campaign.withdrawLocked();
            return;
        }

        uint256 aliceBefore = attr.balanceOf(alice);

        vm.prank(alice);
        campaign.withdrawLocked();

        VestingLockCampaign.Position memory position = campaign.getPosition(alice);
        assertTrue(position.withdrawn, "withdrawn flag mismatch");
        assertTrue(position.forfeited, "forfeited flag mismatch");
        assertEq(campaign.rewardsForfeitedCount(), 1, "forfeited count mismatch");
        assertEq(attr.balanceOf(alice), aliceBefore + amount, "principal return mismatch");

        vm.warp(block.timestamp + LOCK_PERIOD);
        assertFalse(campaign.isRewardClaimable(alice), "forfeited reward should never be claimable");
    }

    /**
     * @notice Fuzz: sweeping cannot remove locked principal when ATTR is both stake and reward token.
     */
    function testFuzz_SweepPreservesPrincipalAndReservedRewards(uint256 amount, uint256 extraReward) public {
        amount = bound(amount, MIN_LOCK, 1_000_000e18);
        extraReward = bound(extraReward, 1, 1_000_000e18);
        VestingLockCampaign campaign = _campaign(false, 0);

        _fundRewards(campaign, REWARD + extraReward);
        _lock(campaign, amount);

        vm.warp(block.timestamp + CAMPAIGN_DURATION + LOCK_PERIOD + 1);

        uint256 recipientBefore = attr.balanceOf(recipient);

        vm.prank(owner);
        campaign.sweepUnallocatedRewards(recipient);

        assertEq(attr.balanceOf(recipient), recipientBefore + extraReward, "sweep amount mismatch");
        assertEq(attr.balanceOf(address(campaign)), amount + REWARD, "reserved balance mismatch");
    }

    /**
     * @notice Fuzz: participant cap is enforced exactly at capacity.
     */
    function testFuzz_ParticipantCapIsEnforced(uint256 amount) public {
        amount = bound(amount, MIN_LOCK, 1_000_000e18);
        VestingLockCampaign campaign = _campaign(false, 1);

        _lock(campaign, amount);

        address bob = makeAddr("bob");
        vm.startPrank(treasury);
        attr.transfer(bob, amount);
        vm.stopPrank();

        vm.startPrank(bob);
        attr.approve(address(campaign), amount);
        vm.expectRevert();
        campaign.lock(amount);
        vm.stopPrank();
    }
}

/**
 * @title VestingLockCampaignFactory Fuzz Tests
 * @notice Fuzzes campaign factory deployment with arbitrary valid campaign parameters.
 */
contract VestingLockCampaignFactoryFuzzTest is Test {
    ATTRToken public attr;
    VestingLockCampaignFactory public factory;

    address public owner;
    address public treasury;

    function setUp() public {
        owner = makeAddr("owner");
        treasury = makeAddr("treasury");

        vm.prank(owner);
        attr = new ATTRToken(1_000_000_000e18, 100_000_000e18, treasury);

        factory = new VestingLockCampaignFactory(owner);
    }

    function testFuzz_CreateCampaignStoresParams(
        uint256 minLockAmount,
        uint256 lockPeriod,
        uint256 rewardAmount,
        uint256 duration,
        uint256 maxParticipants,
        bool allowEarlyWithdraw
    ) public {
        minLockAmount = bound(minLockAmount, 1, 1_000_000e18);
        lockPeriod = bound(lockPeriod, 1, 730 days);
        rewardAmount = bound(rewardAmount, 1, 1_000_000e18);
        duration = bound(duration, 1, 365 days);
        maxParticipants = bound(maxParticipants, 0, 1_000_000);

        VestingLockCampaign.CampaignConfig memory config = VestingLockCampaign.CampaignConfig({
            stakingToken: address(attr),
            allowEarlyWithdraw: allowEarlyWithdraw,
            rewardToken: address(attr),
            minLockAmount: minLockAmount,
            lockPeriod: lockPeriod,
            rewardAmount: rewardAmount,
            campaignStart: block.timestamp,
            campaignEnd: block.timestamp + duration,
            maxParticipants: maxParticipants
        });

        vm.prank(owner);
        address campaignAddress = factory.createCampaign(config);

        VestingLockCampaign campaign = VestingLockCampaign(campaignAddress);
        assertEq(factory.getCampaignCount(), 1, "campaign count mismatch");
        assertEq(factory.getCampaignAt(0), campaignAddress, "campaign address mismatch");
        assertEq(address(campaign.STAKING_TOKEN()), address(attr), "staking token mismatch");
        assertEq(address(campaign.REWARD_TOKEN()), address(attr), "reward token mismatch");
        assertEq(campaign.MIN_LOCK_AMOUNT(), minLockAmount, "min lock mismatch");
        assertEq(campaign.LOCK_PERIOD(), lockPeriod, "lock period mismatch");
        assertEq(campaign.REWARD_AMOUNT(), rewardAmount, "reward amount mismatch");
        assertEq(campaign.CAMPAIGN_START(), block.timestamp, "start mismatch");
        assertEq(campaign.CAMPAIGN_END(), block.timestamp + duration, "end mismatch");
        assertEq(campaign.MAX_PARTICIPANTS(), maxParticipants, "participant cap mismatch");
        assertEq(campaign.ALLOW_EARLY_WITHDRAW(), allowEarlyWithdraw, "early withdrawal mismatch");
        assertEq(campaign.owner(), owner, "campaign owner mismatch");
    }
}
