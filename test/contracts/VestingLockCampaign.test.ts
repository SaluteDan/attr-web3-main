import { describe, it } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress, getAddress } from "viem";

const { viem, networkHelpers } = await hre.network.create();

describe("VestingLockCampaign", function () {
  const CAP = parseEther("1000000000");
  const INITIAL_SUPPLY = parseEther("100000000");
  const MIN_LOCK = parseEther("2500");
  const REWARD = parseEther("5000");
  const USER_LOCK = parseEther("3000");
  const LOCK_PERIOD = 30 * 24 * 60 * 60;

  type Wallet = Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  type ATTRToken = Awaited<ReturnType<typeof viem.deployContract<"ATTRToken">>>;
  type Campaign = Awaited<
    ReturnType<typeof viem.deployContract<"VestingLockCampaign">>
  >;

  async function deployTokenFixture() {
    const [owner, treasury, user, user2, recipient] =
      await viem.getWalletClients();

    const token = await viem.deployContract("ATTRToken", [
      CAP,
      INITIAL_SUPPLY,
      treasury.account.address,
    ]);

    return { owner, treasury, user, user2, recipient, token };
  }

  async function campaignConfig(
    tokenAddress: string,
    overrides: Record<string, unknown> = {},
  ) {
    const now = BigInt(await networkHelpers.time.latest());

    return {
      stakingToken: tokenAddress,
      rewardToken: tokenAddress,
      minLockAmount: MIN_LOCK,
      lockPeriod: BigInt(LOCK_PERIOD),
      rewardAmount: REWARD,
      campaignStart: now - 10n,
      campaignEnd: now + 7n * 24n * 60n * 60n,
      maxParticipants: 0n,
      allowEarlyWithdraw: false,
      ...overrides,
    };
  }

  async function deployCampaignFixture(
    overrides: Record<string, unknown> = {},
  ) {
    const fixture = await deployTokenFixture();
    const config = await campaignConfig(fixture.token.address, overrides);

    const campaign = await viem.deployContract("VestingLockCampaign", [
      fixture.owner.account.address,
      config,
    ]);

    return { ...fixture, campaign, config };
  }

  async function fundAndApproveUser() {
    const fixture = await deployCampaignFixture();

    await fixture.token.write.approve([fixture.campaign.address, REWARD * 3n], {
      account: fixture.treasury.account,
    });
    await fixture.campaign.write.fundRewards([REWARD * 3n], {
      account: fixture.treasury.account,
    });

    await fixture.token.write.transfer(
      [fixture.user.account.address, USER_LOCK],
      { account: fixture.treasury.account },
    );
    await fixture.token.write.approve([fixture.campaign.address, USER_LOCK], {
      account: fixture.user.account,
    });

    return fixture;
  }

  describe("Deployment", function () {
    it("stores reusable campaign parameters", async function () {
      const { campaign, token, config } = await deployCampaignFixture();

      expect(await campaign.read.STAKING_TOKEN()).to.equal(
        getAddress(token.address),
      );
      expect(await campaign.read.REWARD_TOKEN()).to.equal(
        getAddress(token.address),
      );
      expect(await campaign.read.MIN_LOCK_AMOUNT()).to.equal(
        config.minLockAmount,
      );
      expect(await campaign.read.LOCK_PERIOD()).to.equal(config.lockPeriod);
      expect(await campaign.read.REWARD_AMOUNT()).to.equal(config.rewardAmount);
    });

    it("rejects invalid configuration", async function () {
      const { owner, token } = await deployTokenFixture();
      const validConfig = await campaignConfig(token.address);
      const refCampaign = await viem.deployContract("VestingLockCampaign", [
        owner.account.address,
        validConfig,
      ]);

      const invalidConfig = await campaignConfig(token.address, {
        minLockAmount: 0n,
      });

      await viem.assertions.revertWithCustomError(
        viem.deployContract("VestingLockCampaign", [
          owner.account.address,
          invalidConfig,
        ]),
        refCampaign,
        "InvalidCampaignConfig",
      );
    });
  });

  describe("Locking and claiming", function () {
    it("locks tokens and claims the reward after the configured period", async function () {
      const { campaign, token, user } = await fundAndApproveUser();

      await viem.assertions.emit(
        campaign.write.lock([USER_LOCK], { account: user.account }),
        campaign,
        "Locked",
      );

      expect(await token.read.balanceOf([campaign.address])).to.equal(
        REWARD * 3n + USER_LOCK,
      );
      expect(
        await campaign.read.isRewardClaimable([user.account.address]),
      ).to.equal(false);

      await networkHelpers.time.increase(BigInt(LOCK_PERIOD));

      await viem.assertions.emitWithArgs(
        campaign.write.claimReward({ account: user.account }),
        campaign,
        "RewardClaimed",
        [getAddress(user.account.address), REWARD],
      );

      expect(await token.read.balanceOf([user.account.address])).to.equal(
        REWARD,
      );

      await viem.assertions.emitWithArgs(
        campaign.write.withdrawLocked({ account: user.account }),
        campaign,
        "LockedTokensWithdrawn",
        [getAddress(user.account.address), USER_LOCK, false],
      );

      expect(await token.read.balanceOf([user.account.address])).to.equal(
        REWARD + USER_LOCK,
      );
    });

    it("does not allow a reward claim before the lock period", async function () {
      const { campaign, user } = await fundAndApproveUser();

      await campaign.write.lock([USER_LOCK], { account: user.account });

      await viem.assertions.revertWithCustomError(
        campaign.write.claimReward({ account: user.account }),
        campaign,
        "RewardNotClaimable",
      );
    });

    it("prevents more than one position per wallet", async function () {
      const { campaign, token, treasury, user } = await fundAndApproveUser();

      await campaign.write.lock([USER_LOCK], { account: user.account });

      await token.write.transfer([user.account.address, USER_LOCK], {
        account: treasury.account,
      });
      await token.write.approve([campaign.address, USER_LOCK], {
        account: user.account,
      });

      await viem.assertions.revertWithCustomError(
        campaign.write.lock([USER_LOCK], { account: user.account }),
        campaign,
        "PositionAlreadyExists",
      );
    });

    it("enforces the minimum lock amount", async function () {
      const { campaign, token, treasury, user } = await deployCampaignFixture();
      const tooSmall = MIN_LOCK - 1n;

      await token.write.transfer([user.account.address, tooSmall], {
        account: treasury.account,
      });
      await token.write.approve([campaign.address, tooSmall], {
        account: user.account,
      });

      await viem.assertions.revertWithCustomError(
        campaign.write.lock([tooSmall], { account: user.account }),
        campaign,
        "InsufficientLockAmount",
      );
    });
  });

  describe("Withdrawals", function () {
    it("can allow early withdrawal and forfeit the reward", async function () {
      const earlyFixture = await deployCampaignFixture({
        allowEarlyWithdraw: true,
      });
      await earlyFixture.token.write.approve(
        [earlyFixture.campaign.address, REWARD],
        { account: earlyFixture.treasury.account },
      );
      await earlyFixture.campaign.write.fundRewards([REWARD], {
        account: earlyFixture.treasury.account,
      });
      await earlyFixture.token.write.transfer(
        [earlyFixture.user.account.address, USER_LOCK],
        { account: earlyFixture.treasury.account },
      );
      await earlyFixture.token.write.approve(
        [earlyFixture.campaign.address, USER_LOCK],
        { account: earlyFixture.user.account },
      );

      await earlyFixture.campaign.write.lock([USER_LOCK], {
        account: earlyFixture.user.account,
      });
      await viem.assertions.emitWithArgs(
        earlyFixture.campaign.write.withdrawLocked({
          account: earlyFixture.user.account,
        }),
        earlyFixture.campaign,
        "LockedTokensWithdrawn",
        [getAddress(earlyFixture.user.account.address), USER_LOCK, true],
      );

      expect(
        await earlyFixture.campaign.read.isRewardClaimable([
          earlyFixture.user.account.address,
        ]),
      ).to.equal(false);
      expect(await earlyFixture.campaign.read.rewardsForfeitedCount()).to.equal(
        1n,
      );

      await networkHelpers.time.increase(BigInt(LOCK_PERIOD));
      await viem.assertions.revertWithCustomError(
        earlyFixture.campaign.write.claimReward({
          account: earlyFixture.user.account,
        }),
        earlyFixture.campaign,
        "RewardNotClaimable",
      );
    });

    it("does not sweep locked principal when ATTR is both stake and reward token", async function () {
      const { campaign, token, treasury, user, recipient } =
        await fundAndApproveUser();

      await campaign.write.lock([USER_LOCK], { account: user.account });
      await networkHelpers.time.increase(
        BigInt(LOCK_PERIOD + 8 * 24 * 60 * 60),
      );

      const balanceBefore = await token.read.balanceOf([
        recipient.account.address,
      ]);
      await token.write.approve([campaign.address, REWARD], {
        account: treasury.account,
      });
      await campaign.write.fundRewards([REWARD], {
        account: treasury.account,
      });

      await viem.assertions.emitWithArgs(
        campaign.write.sweepUnallocatedRewards([recipient.account.address]),
        campaign,
        "RewardSwept",
        [getAddress(recipient.account.address), REWARD * 3n],
      );

      expect(await token.read.balanceOf([recipient.account.address])).to.equal(
        balanceBefore + REWARD * 3n,
      );
      expect(await token.read.balanceOf([campaign.address])).to.equal(
        USER_LOCK + REWARD,
      );
    });
  });
});

describe("VestingLockCampaignFactory", function () {
  it("deploys isolated campaigns and records them", async function () {
    const [owner, treasury] = await viem.getWalletClients();
    const token = await viem.deployContract("ATTRToken", [
      parseEther("1000000000"),
      parseEther("100000000"),
      treasury.account.address,
    ]);

    const factory = await viem.deployContract("VestingLockCampaignFactory", [
      owner.account.address,
    ]);

    const now = BigInt(await networkHelpers.time.latest());
    const config = {
      stakingToken: token.address,
      rewardToken: token.address,
      minLockAmount: parseEther("100"),
      lockPeriod: 7n * 24n * 60n * 60n,
      rewardAmount: parseEther("25"),
      campaignStart: now,
      campaignEnd: now + 30n * 24n * 60n * 60n,
      maxParticipants: 100n,
      allowEarlyWithdraw: true,
    };

    await viem.assertions.emit(
      factory.write.createCampaign([config]),
      factory,
      "CampaignDeployed",
    );

    expect(await factory.read.getCampaignCount()).to.equal(1n);
    const campaignAddress = await factory.read.getCampaignAt([0n]);
    expect(campaignAddress).to.not.equal(zeroAddress);

    const deployedCampaign = await viem.getContractAt(
      "VestingLockCampaign",
      campaignAddress,
    );
    expect(await deployedCampaign.read.owner()).to.equal(
      getAddress(owner.account.address),
    );
    expect(await deployedCampaign.read.MIN_LOCK_AMOUNT()).to.equal(
      config.minLockAmount,
    );
    expect(await deployedCampaign.read.ALLOW_EARLY_WITHDRAW()).to.equal(true);
  });
});
