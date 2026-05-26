import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress, getAddress } from "viem";

const { viem, networkHelpers } = await hre.network.create();

describe("MembershipFeeDistributor", function () {
  let distributor: Awaited<
    ReturnType<typeof viem.deployContract<"MembershipFeeDistributor">>
  >;
  let membership: Awaited<
    ReturnType<typeof viem.deployContract<"MembershipToken">>
  >;
  let attr: Awaited<ReturnType<typeof viem.deployContract<"ATTRToken">>>;
  let dao: Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  let user1: typeof dao;
  let user2: typeof dao;
  let user3: typeof dao;
  let stranger: typeof dao;
  let publicClient: Awaited<ReturnType<typeof viem.getPublicClient>>;

  // 3 tokens minted in beforeEach
  const TOTAL_MINTED = 3n;

  beforeEach(async function () {
    [dao, user1, user2, user3, stranger] = await viem.getWalletClients();
    publicClient = await viem.getPublicClient();

    // ── Deploy MembershipToken and mint 3 tokens ───────────────────────────
    membership = await viem.deployContract("MembershipToken", [
      "ATTR-MEMBER-ID",
      "ATTR#",
      dao.account.address,
      dao.account.address,
      dao.account.address,
      500n,
      "ipfs://test",
      50000n,
      5n,
    ]);

    // Mint token 0 → user1, token 1 → user2, token 2 → user3
    await membership.write.adminMintMembership([
      user1.account.address,
      1n,
      "ipfs://1",
    ]);
    await membership.write.adminMintMembership([
      user2.account.address,
      1n,
      "ipfs://2",
    ]);
    await membership.write.adminMintMembership([
      user3.account.address,
      1n,
      "ipfs://3",
    ]);

    // ── Deploy ATTRToken ───────────────────────────────────────────────────
    attr = await viem.deployContract("ATTRToken", [
      parseEther("1000000"),
      parseEther("10000"),
      dao.account.address,
    ]);

    // ── Deploy MembershipFeeDistributor ────────────────────────────────────
    distributor = await viem.deployContract("MembershipFeeDistributor", [
      membership.address,
      dao.account.address,
    ]);

    // Set snapshot so deposits are accepted
    await distributor.write.setTotalMintedSnapshot([TOTAL_MINTED]);
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should store membershipToken address", async function () {
      expect(await distributor.read.membershipToken()).to.equal(
        getAddress(membership.address),
      );
    });

    it("Should set correct owner", async function () {
      expect(await distributor.read.owner()).to.equal(
        getAddress(dao.account.address),
      );
    });

    it("Should revert on zero membershipToken address", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("MembershipFeeDistributor", [
          zeroAddress,
          dao.account.address,
        ]),
        distributor,
        "ZeroAddress",
      );
    });

    it("Should revert on zero daoOwner address", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("MembershipFeeDistributor", [
          membership.address,
          zeroAddress,
        ]),
        distributor,
        "OwnableInvalidOwner",
      );
    });
  });

  // ── setTotalMintedSnapshot ─────────────────────────────────────────────────

  describe("setTotalMintedSnapshot", function () {
    it("Should update the snapshot and emit event", async function () {
      await viem.assertions.emitWithArgs(
        distributor.write.setTotalMintedSnapshot([10n]),
        distributor,
        "TotalMintedSnapshotUpdated",
        [TOTAL_MINTED, 10n],
      );
      expect(await distributor.read.totalMintedSnapshot()).to.equal(10n);
    });

    it("Should revert if called by non-owner", async function () {
      await viem.assertions.revertWithCustomError(
        distributor.write.setTotalMintedSnapshot([10n], {
          account: stranger.account,
        }),
        distributor,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ── depositETH ─────────────────────────────────────────────────────────────

  describe("depositETH", function () {
    it("Should update the ETH reward index on deposit", async function () {
      const depositAmount = parseEther("3"); // 1 ETH per token
      await viem.assertions.emit(
        distributor.write.depositETH({ value: depositAmount }),
        distributor,
        "ETHDeposited",
      );
    });

    it("Should revert on zero deposit", async function () {
      await viem.assertions.revertWithCustomError(
        distributor.write.depositETH({ value: 0n }),
        distributor,
        "ZeroDeposit",
      );
    });

    it("Should revert if totalMintedSnapshot is 0", async function () {
      const fresh = await viem.deployContract("MembershipFeeDistributor", [
        membership.address,
        dao.account.address,
      ]);
      await viem.assertions.revertWithCustomError(
        fresh.write.depositETH({ value: parseEther("1") }),
        distributor,
        "InvalidMaxSupply",
      );
    });

    it("Should revert if called by non-owner", async function () {
      await viem.assertions.revertWithCustomError(
        distributor.write.depositETH({
          value: parseEther("1"),
          account: stranger.account,
        }),
        distributor,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should reject direct ETH sends (receive reverts)", async function () {
      let reverted = false;
      try {
        await dao.sendTransaction({
          to: distributor.address,
          value: parseEther("1"),
        });
      } catch {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });

  // ── claimETH ───────────────────────────────────────────────────────────────

  describe("claimETH", function () {
    const PER_TOKEN = parseEther("1");

    beforeEach(async function () {
      // Deposit 3 ETH → 1 ETH per token
      await distributor.write.depositETH({
        value: PER_TOKEN * TOTAL_MINTED,
      });
    });

    it("claimableETH should return 1 ETH per token before claim", async function () {
      expect(await distributor.read.claimableETH([[0n]])).to.equal(PER_TOKEN);
      expect(await distributor.read.claimableETH([[1n]])).to.equal(PER_TOKEN);
      expect(await distributor.read.claimableETH([[2n]])).to.equal(PER_TOKEN);
      expect(await distributor.read.claimableETH([[0n, 1n, 2n]])).to.equal(
        PER_TOKEN * 3n,
      );
    });

    it("Should transfer 1 ETH to user1 for token 0", async function () {
      const before = await publicClient.getBalance({
        address: user1.account.address,
      });
      const hash = await distributor.write.claimETH([[0n]], {
        account: user1.account,
      });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await publicClient.getBalance({
        address: user1.account.address,
      });
      expect(after - before + gasUsed).to.equal(PER_TOKEN);
    });

    it("Should emit ETHClaimed event", async function () {
      await viem.assertions.emitWithArgs(
        distributor.write.claimETH([[0n]], { account: user1.account }),
        distributor,
        "ETHClaimed",
        [getAddress(user1.account.address), [0n], PER_TOKEN],
      );
    });

    it("Should set claimable to 0 after claim", async function () {
      await distributor.write.claimETH([[0n]], { account: user1.account });
      expect(await distributor.read.claimableETH([[0n]])).to.equal(0n);
    });

    it("Should allow batch claim for multiple tokens owned by same user", async function () {
      // Give user1 a second token via transfer from user2
      await membership.write.transferFrom(
        [user2.account.address, user1.account.address, 1n],
        { account: user2.account },
      );
      const before = await publicClient.getBalance({
        address: user1.account.address,
      });
      const hash = await distributor.write.claimETH([[0n, 1n]], {
        account: user1.account,
      });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await publicClient.getBalance({
        address: user1.account.address,
      });
      expect(after - before + gasUsed).to.equal(PER_TOKEN * 2n);
    });

    it("Should revert on empty tokenIds array", async function () {
      await viem.assertions.revertWithCustomError(
        distributor.write.claimETH([[]], { account: user1.account }),
        distributor,
        "NoTokenIds",
      );
    });

    it("Should revert if caller does not own a token ID", async function () {
      // user1 tries to claim token 1 (owned by user2)
      await viem.assertions.revertWithCustomError(
        distributor.write.claimETH([[1n]], { account: user1.account }),
        distributor,
        "NotTokenOwner",
      );
    });

    it("Should revert with NothingToClaim if no rewards have accumulated since last claim", async function () {
      await distributor.write.claimETH([[0n]], { account: user1.account });
      await viem.assertions.revertWithCustomError(
        distributor.write.claimETH([[0n]], { account: user1.account }),
        distributor,
        "NothingToClaim",
      );
    });

    it("Should accumulate rewards across multiple deposits", async function () {
      // Second deposit of another 1 ETH per token
      await distributor.write.depositETH({
        value: PER_TOKEN * TOTAL_MINTED,
      });

      expect(await distributor.read.claimableETH([[0n]])).to.equal(
        PER_TOKEN * 2n,
      );
      const before = await publicClient.getBalance({
        address: user1.account.address,
      });
      const hash = await distributor.write.claimETH([[0n]], {
        account: user1.account,
      });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await publicClient.getBalance({
        address: user1.account.address,
      });
      expect(after - before + gasUsed).to.equal(PER_TOKEN * 2n);
    });
  });

  // ── depositERC20 + claimERC20 ──────────────────────────────────────────────

  describe("ERC20 rewards (depositERC20 + claimERC20)", function () {
    const PER_TOKEN_ERC20 = parseEther("100"); // 100 ATTR per token

    beforeEach(async function () {
      const totalDeposit = PER_TOKEN_ERC20 * TOTAL_MINTED;
      await attr.write.approve([distributor.address, totalDeposit]);
      await distributor.write.depositERC20([attr.address, totalDeposit]);
    });

    it("claimableERC20 should return 100 ATTR per token", async function () {
      expect(
        await distributor.read.claimableERC20([attr.address, [0n]]),
      ).to.equal(PER_TOKEN_ERC20);
      expect(
        await distributor.read.claimableERC20([attr.address, [0n, 1n, 2n]]),
      ).to.equal(PER_TOKEN_ERC20 * 3n);
    });

    it("Should transfer 100 ATTR to user1 for token 0", async function () {
      const before = await attr.read.balanceOf([user1.account.address]);
      await viem.assertions.emitWithArgs(
        distributor.write.claimERC20([attr.address, [0n]], {
          account: user1.account,
        }),
        distributor,
        "ERC20Claimed",
        [
          getAddress(user1.account.address),
          getAddress(attr.address),
          [0n],
          PER_TOKEN_ERC20,
        ],
      );
      expect(await attr.read.balanceOf([user1.account.address])).to.equal(
        before + PER_TOKEN_ERC20,
      );
    });

    it("Should set claimable to 0 after ERC20 claim", async function () {
      await distributor.write.claimERC20([attr.address, [0n]], {
        account: user1.account,
      });
      expect(
        await distributor.read.claimableERC20([attr.address, [0n]]),
      ).to.equal(0n);
    });

    it("Should revert on empty tokenIds array", async function () {
      await viem.assertions.revertWithCustomError(
        distributor.write.claimERC20([attr.address, []], {
          account: user1.account,
        }),
        distributor,
        "NoTokenIds",
      );
    });

    it("Should revert if caller does not own the token", async function () {
      await viem.assertions.revertWithCustomError(
        distributor.write.claimERC20([attr.address, [1n]], {
          account: user1.account,
        }),
        distributor,
        "NotTokenOwner",
      );
    });

    it("Should revert with NothingToClaim on double claim", async function () {
      await distributor.write.claimERC20([attr.address, [0n]], {
        account: user1.account,
      });
      await viem.assertions.revertWithCustomError(
        distributor.write.claimERC20([attr.address, [0n]], {
          account: user1.account,
        }),
        distributor,
        "NothingToClaim",
      );
    });

    it("Should revert depositERC20 on zero amount", async function () {
      await viem.assertions.revertWithCustomError(
        distributor.write.depositERC20([attr.address, 0n]),
        distributor,
        "ZeroDeposit",
      );
    });

    it("Should revert depositERC20 if called by non-owner", async function () {
      await attr.write.transfer([stranger.account.address, PER_TOKEN_ERC20]);
      await attr.write.approve([distributor.address, PER_TOKEN_ERC20], {
        account: stranger.account,
      });
      await viem.assertions.revertWithCustomError(
        distributor.write.depositERC20([attr.address, PER_TOKEN_ERC20], {
          account: stranger.account,
        }),
        distributor,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});
