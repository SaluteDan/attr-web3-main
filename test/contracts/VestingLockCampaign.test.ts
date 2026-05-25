import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

describe("VestingLockCampaign", function () {
  const CAP = ethers.parseEther("1000000000");
  const INITIAL_SUPPLY = ethers.parseEther("100000000");
  const MIN_LOCK = ethers.parseEther("2500");
  const REWARD = ethers.parseEther("5000");
  const USER_LOCK = ethers.parseEther("3000");
  const LOCK_PERIOD = 30 * 24 * 60 * 60;

  async function deployTokenFixture() {
    const [owner, treasury, user, user2, recipient] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ATTRToken");
    const token = await Token.deploy(CAP, INITIAL_SUPPLY, treasury.address);
    await token.waitForDeployment();

    return { owner, treasury, user, user2, recipient, token };
  }

  async function campaignConfig(tokenAddress: string, overrides: Record<string, unknown> = {}) {
    const now = await time.latest();

    return {
      stakingToken: tokenAddress,
      rewardToken: tokenAddress,
      minLockAmount: MIN_LOCK,
      lockPeriod: LOCK_PERIOD,
      rewardAmount: REWARD,
      campaignStart: now - 10,
      campaignEnd: now + 7 * 24 * 60 * 60,
      maxParticipants: 0,
      allowEarlyWithdraw: false,
      ...overrides,
    };
  }

  async function deployCampaignFixture(overrides: Record<string, unknown> = {}) {
    const fixture = await deployTokenFixture();
    const tokenAddress = await fixture.token.getAddress();
    const config = await campaignConfig(tokenAddress, overrides);

    const Campaign = await ethers.getContractFactory("VestingLockCampaign");
    const campaign = await Campaign.deploy(fixture.owner.address, config);
    await campaign.waitForDeployment();

    return { ...fixture, campaign, config };
  }

  async function fundAndApproveUser() {
    const fixture = await deployCampaignFixture();
    const campaignAddress = await fixture.campaign.getAddress();

    await fixture.token
      .connect(fixture.treasury)
      .approve(campaignAddress, REWARD * 3n);
    await fixture.campaign.connect(fixture.treasury).fundRewards(REWARD * 3n);

    await fixture.token
      .connect(fixture.treasury)
      .transfer(fixture.user.address, USER_LOCK);
    await fixture.token.connect(fixture.user).approve(campaignAddress, USER_LOCK);

    return fixture;
  }

  describe("Deployment", function () {
    it("stores reusable campaign parameters", async function () {
      const { campaign, token, config } = await deployCampaignFixture();
      const tokenAddress = await token.getAddress();

      expect(await campaign.STAKING_TOKEN()).to.equal(tokenAddress);
      expect(await campaign.REWARD_TOKEN()).to.equal(tokenAddress);
      expect(await campaign.MIN_LOCK_AMOUNT()).to.equal(config.minLockAmount);
      expect(await campaign.LOCK_PERIOD()).to.equal(config.lockPeriod);
      expect(await campaign.REWARD_AMOUNT()).to.equal(config.rewardAmount);
    });

    it("rejects invalid configuration", async function () {
      const { owner, token } = await deployTokenFixture();
      const Campaign = await ethers.getContractFactory("VestingLockCampaign");
      const config = await campaignConfig(await token.getAddress(), {
        minLockAmount: 0,
      });

      await expect(
        Campaign.deploy(owner.address, config),
      ).to.be.revertedWithCustomError(Campaign, "InvalidCampaignConfig");
    });
  });

  describe("Locking and claiming", function () {
    it("locks tokens and claims the reward after the configured period", async function () {
      const { campaign, token, user } = await fundAndApproveUser();

      await expect(campaign.connect(user).lock(USER_LOCK))
        .to.emit(campaign, "Locked")
        .withArgs(user.address, USER_LOCK, anyValue);

      expect(await token.balanceOf(await campaign.getAddress())).to.equal(
        REWARD * 3n + USER_LOCK,
      );
      expect(await campaign.isRewardClaimable(user.address)).to.equal(false);

      await time.increase(LOCK_PERIOD);

      await expect(campaign.connect(user).claimReward())
        .to.emit(campaign, "RewardClaimed")
        .withArgs(user.address, REWARD);

      expect(await token.balanceOf(user.address)).to.equal(REWARD);

      await expect(campaign.connect(user).withdrawLocked())
        .to.emit(campaign, "LockedTokensWithdrawn")
        .withArgs(user.address, USER_LOCK, false);

      expect(await token.balanceOf(user.address)).to.equal(REWARD + USER_LOCK);
    });

    it("does not allow a reward claim before the lock period", async function () {
      const { campaign, user } = await fundAndApproveUser();

      await campaign.connect(user).lock(USER_LOCK);

      await expect(
        campaign.connect(user).claimReward(),
      ).to.be.revertedWithCustomError(campaign, "RewardNotClaimable");
    });

    it("prevents more than one position per wallet", async function () {
      const { campaign, token, treasury, user } = await fundAndApproveUser();
      const campaignAddress = await campaign.getAddress();

      await campaign.connect(user).lock(USER_LOCK);

      await token.connect(treasury).transfer(user.address, USER_LOCK);
      await token.connect(user).approve(campaignAddress, USER_LOCK);

      await expect(
        campaign.connect(user).lock(USER_LOCK),
      ).to.be.revertedWithCustomError(campaign, "PositionAlreadyExists");
    });

    it("enforces the minimum lock amount", async function () {
      const { campaign, token, treasury, user } = await deployCampaignFixture();
      const campaignAddress = await campaign.getAddress();
      const tooSmall = MIN_LOCK - 1n;

      await token.connect(treasury).transfer(user.address, tooSmall);
      await token.connect(user).approve(campaignAddress, tooSmall);

      await expect(
        campaign.connect(user).lock(tooSmall),
      ).to.be.revertedWithCustomError(campaign, "InsufficientLockAmount");
    });
  });

  describe("Withdrawals", function () {
    it("can allow early withdrawal and forfeit the reward", async function () {
      const earlyFixture = await deployCampaignFixture({ allowEarlyWithdraw: true });
      const campaignAddress = await earlyFixture.campaign.getAddress();
      await earlyFixture.token
        .connect(earlyFixture.treasury)
        .approve(campaignAddress, REWARD);
      await earlyFixture.campaign.connect(earlyFixture.treasury).fundRewards(REWARD);
      await earlyFixture.token
        .connect(earlyFixture.treasury)
        .transfer(earlyFixture.user.address, USER_LOCK);
      await earlyFixture.token.connect(earlyFixture.user).approve(campaignAddress, USER_LOCK);

      await earlyFixture.campaign.connect(earlyFixture.user).lock(USER_LOCK);
      await expect(earlyFixture.campaign.connect(earlyFixture.user).withdrawLocked())
        .to.emit(earlyFixture.campaign, "LockedTokensWithdrawn")
        .withArgs(earlyFixture.user.address, USER_LOCK, true);

      expect(await earlyFixture.campaign.isRewardClaimable(earlyFixture.user.address)).to.equal(false);
      expect(await earlyFixture.campaign.rewardsForfeitedCount()).to.equal(1);

      await time.increase(LOCK_PERIOD);
      await expect(
        earlyFixture.campaign.connect(earlyFixture.user).claimReward(),
      ).to.be.revertedWithCustomError(earlyFixture.campaign, "RewardNotClaimable");
    });

    it("does not sweep locked principal when ATTR is both stake and reward token", async function () {
      const { campaign, token, treasury, user, recipient } = await fundAndApproveUser();

      await campaign.connect(user).lock(USER_LOCK);
      await time.increase(LOCK_PERIOD + 8 * 24 * 60 * 60);

      const balanceBefore = await token.balanceOf(recipient.address);
      await token.connect(treasury).approve(await campaign.getAddress(), REWARD);
      await campaign.connect(treasury).fundRewards(REWARD);

      await expect(campaign.sweepUnallocatedRewards(recipient.address))
        .to.emit(campaign, "RewardSwept")
        .withArgs(recipient.address, REWARD * 3n);

      expect(await token.balanceOf(recipient.address)).to.equal(balanceBefore + REWARD * 3n);
      expect(await token.balanceOf(await campaign.getAddress())).to.equal(
        USER_LOCK + REWARD,
      );
    });
  });
});

describe("VestingLockCampaignFactory", function () {
  it("deploys isolated campaigns and records them", async function () {
    const [owner, treasury] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("ATTRToken");
    const token = await Token.deploy(
      ethers.parseEther("1000000000"),
      ethers.parseEther("100000000"),
      treasury.address,
    );
    await token.waitForDeployment();

    const Factory = await ethers.getContractFactory("VestingLockCampaignFactory");
    const factory = await Factory.deploy(owner.address);
    await factory.waitForDeployment();

    const now = await time.latest();
    const config = {
      stakingToken: await token.getAddress(),
      rewardToken: await token.getAddress(),
      minLockAmount: ethers.parseEther("100"),
      lockPeriod: 7 * 24 * 60 * 60,
      rewardAmount: ethers.parseEther("25"),
      campaignStart: now,
      campaignEnd: now + 30 * 24 * 60 * 60,
      maxParticipants: 100,
      allowEarlyWithdraw: true,
    };

    await expect(factory.createCampaign(config)).to.emit(factory, "CampaignDeployed");

    expect(await factory.getCampaignCount()).to.equal(1);
    const campaignAddress = await factory.getCampaignAt(0);
    expect(campaignAddress).to.not.equal(ethers.ZeroAddress);

    const deployedCampaign = await ethers.getContractAt(
      "VestingLockCampaign",
      campaignAddress,
    );
    expect(await deployedCampaign.owner()).to.equal(owner.address);
    expect(await deployedCampaign.MIN_LOCK_AMOUNT()).to.equal(config.minLockAmount);
    expect(await deployedCampaign.ALLOW_EARLY_WITHDRAW()).to.equal(true);
  });
});
