import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, getAddress, zeroAddress } from "viem";

const { viem, networkHelpers } = await hre.network.create();

/**
 * Extended Hardhat suite for the tier-weighted MembershipFeeDistributor.
 *
 * Model under test:
 *   W          = 225*nT1 + 100*nT2      (live, recomputed)
 *   pool       = D - (D % W)            (residue carried forward as dust)
 *   T1 share   = pool * 225 / W
 *   T2 share   = pool * 100 / W
 *   T1 / T2    = exactly 2.25x per identical deposit, any supply mix
 *   accrual    = share * dt / WINDOW    (continuous interval ownership)
 */
describe("MembershipFeeDistributor (tier-weighted)", function () {
  let dist: Awaited<ReturnType<typeof viem.deployContract<"MembershipFeeDistributor">>>;
  let membership: Awaited<ReturnType<typeof viem.deployContract<"MockMembershipToken">>>;
  let usdc: Awaited<ReturnType<typeof viem.deployContract<"MockFeeUSDC">>>;
  let dao: Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  let user1: typeof dao;
  let user2: typeof dao;
  let user3: typeof dao;
  let stranger: typeof dao;
  let publicClient: Awaited<ReturnType<typeof viem.getPublicClient>>;

  const WINDOW = 86_400n; // 1 day, matching MembershipFeeDistributor.WINDOW
  const D = parseEther("6.5"); // divisible by 650 => no dust for the 2xT1+2xT2 grid

  beforeEach(async function () {
    [dao, user1, user2, user3, stranger] = await viem.getWalletClients();
    publicClient = await viem.getPublicClient();

    membership = await viem.deployContract("MockMembershipToken", [
      "ATTR-MEMBER-ID",
      "ATTR#",
    ]);
    usdc = await viem.deployContract("MockFeeUSDC");
    dist = await viem.deployContract("MembershipFeeDistributor", [
      membership.address,
      dao.account.address,
    ]);

    // Fund the DAO wallet so repeated deposits never exhaust the default balance.
    await networkHelpers.setBalance(dao.account.address, 100_000n * 10n ** 18n);

    // Open the deposit gate.
    await dist.write.setTotalMintedSnapshot([2n ** 256n - 1n]);
  });

  async function mintTier(account: typeof dao, tier: number) {
    await membership.write.mint([account.account.address, BigInt(tier)]);
  }

  async function warpWindow() {
    await networkHelpers.time.increase(Number(WINDOW));
  }

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("stores the membership token address", async function () {
      expect((await dist.read.membershipToken()).toLowerCase()).to.equal(
        membership.address.toLowerCase(),
      );
    });

    it("sets the correct owner", async function () {
      expect((await dist.read.owner()).toLowerCase()).to.equal(
        dao.account.address.toLowerCase(),
      );
    });

    it("exposes the accrual window constant", async function () {
      expect(await dist.read.WINDOW()).to.equal(WINDOW);
    });

    it("starts with the deposit gate closed", async function () {
      const fresh = await viem.deployContract("MembershipFeeDistributor", [
        membership.address,
        dao.account.address,
      ]);
      expect(await fresh.read.totalMintedSnapshot()).to.equal(0n);
    });
  });

  // ── Gateway / snapshot semantics ───────────────────────────────────────────

  describe("setKeeper", function () {
    it("rejects a zero keeper", async function () {
      // A zero keeper would silently disable keeper-gated pushes.
      await viem.assertions.revertWithCustomError(
        dist.write.setKeeper([zeroAddress]),
        dist,
        "ZeroAddress",
      );
    });

    it("allows the owner to set a real keeper", async function () {
      const [, , keeper] = await viem.getWalletClients();
      await dist.write.setKeeper([keeper.account.address]);
      expect(await dist.read.keeper()).to.equal(
        getAddress(keeper.account.address),
      );
    });
  });

  describe("setTotalMintedSnapshot (gate only)", function () {
    it("updates the gate and emits the event", async function () {
      await viem.assertions.emitWithArgs(
        dist.write.setTotalMintedSnapshot([42n]),
        dist,
        "TotalMintedSnapshotUpdated",
        [2n ** 256n - 1n, 42n],
      );
      expect(await dist.read.totalMintedSnapshot()).to.equal(42n);
    });

    it("reverts when called by a non-owner", async function () {
      await viem.assertions.revertWithCustomError(
        dist.write.setTotalMintedSnapshot([1n], { account: stranger.account }),
        dist,
        "OwnableUnauthorizedAccount",
      );
    });

    it("blocks deposits while the gate is zero", async function () {
      const fresh = await viem.deployContract("MembershipFeeDistributor", [
        membership.address,
        dao.account.address,
      ]);
      await mintTier(user1, 1);
      await viem.assertions.revertWithCustomError(
        fresh.write.depositETH({ value: parseEther("1") }),
        fresh,
        "InvalidMaxSupply",
      );
    });

    it("never uses the gate value as the divisor", async function () {
      await mintTier(user1, 1);
      await mintTier(user2, 2); // W = 325
      await dist.write.setTotalMintedSnapshot([1n]);
      const amount = parseEther("325");
      await dist.write.depositETH({ value: amount });
      // pool = amount - (amount % 325) == amount here; divisor is the LIVE W.
      expect(await dist.read.ethPricePerWeight()).to.equal(amount);
    });
  });

  // ── depositETH ─────────────────────────────────────────────────────────────

  describe("depositETH", function () {
    it("updates the ETH interval pool on deposit", async function () {
      await mintTier(user1, 1);
      await viem.assertions.emit(
        dist.write.depositETH({ value: parseEther("1") }),
        dist,
        "ETHDeposited",
      );
    });

    it("reverts on a zero deposit", async function () {
      await viem.assertions.revertWithCustomError(
        dist.write.depositETH({ value: 0n }),
        dist,
        "ZeroDeposit",
      );
    });

    it("reverts when called by a non-owner", async function () {
      await viem.assertions.revertWithCustomError(
        dist.write.depositETH({
          value: parseEther("1"),
          account: stranger.account,
        }),
        dist,
        "OwnableUnauthorizedAccount",
      );
    });

    it("rejects direct ETH sends (receive reverts)", async function () {
      let reverted = false;
      try {
        await dao.sendTransaction({
          to: dist.address,
          value: parseEther("1"),
        });
      } catch {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });

  // ── Tier-weight correctness ────────────────────────────────────────────────

  describe("tier weights", function () {
    it("gives T1 exactly 2.25x a T2 for an identical deposit", async function () {
      await mintTier(user1, 1); // T1
      await mintTier(user2, 2); // T2
      // W = 325; pool = D - (D % 325)
      await dist.write.depositETH({ value: D });
      await warpWindow();

      const dueT1 = await dist.read.claimableETH([[0n]]);
      const dueT2 = await dist.read.claimableETH([[1n]]);
      expect(dueT1 * 100n).to.equal(dueT2 * 225n);
    });

    it("splits 2xT1 + 2xT2 by weight (34.615% / 15.385%)", async function () {
      await mintTier(user1, 1);
      await mintTier(user2, 1);
      await mintTier(user3, 2);
      await mintTier(stranger, 2);
      // W = 650, and D is divisible by 650 so pool == D exactly.
      await dist.write.depositETH({ value: D });
      await warpWindow();

      const w = 650n;
      expect(await dist.read.claimableETH([[0n]])).to.equal((D * 225n) / w);
      expect(await dist.read.claimableETH([[2n]])).to.equal((D * 100n) / w);
      expect(await dist.read.claimableETH([[0n, 1n, 2n, 3n]])).to.equal(
        (D * 225n * 2n + D * 100n * 2n) / w,
      );
    });

    it("is parameterised across the nT1 x nT2 grid", async function () {
      for (let nT1 = 0; nT1 <= 3; nT1++) {
        for (let nT2 = 0; nT2 <= 3; nT2++) {
          if (nT1 + nT2 === 0) continue;
          const m = await viem.deployContract("MockMembershipToken", [
            "A",
            "A",
          ]);
          const d = await viem.deployContract("MembershipFeeDistributor", [
            m.address,
            dao.account.address,
          ]);
          await d.write.setTotalMintedSnapshot([2n ** 256n - 1n]);
          const owner = (await viem.getWalletClients())[0];
          await networkHelpers.setBalance(owner.account.address, 100_000n * 10n ** 18n);
          for (let i = 0; i < nT1; i++) {
            await m.write.mint([owner.account.address, 1n]);
          }
          for (let i = 0; i < nT2; i++) {
            await m.write.mint([owner.account.address, 2n]);
          }
          await d.write.depositETH({ value: D });
          await networkHelpers.time.increase(Number(WINDOW));

          const w = BigInt(225 * nT1 + 100 * nT2);
          const pool = D - (D % w);
          const ids = Array.from({ length: nT1 + nT2 }, (_, i) => BigInt(i));
          const sum = await d.read.claimableETH([ids]);
          expect(sum <= D).to.be.true;
          if (nT1 > 0) {
            expect(await d.read.claimableETH([[0n]])).to.equal((pool * 225n) / w);
          }
          if (nT2 > 0) {
            expect(await d.read.claimableETH([[BigInt(nT1)]])).to.equal(
              (pool * 100n) / w,
            );
          }
        }
      }
    });

    it("gives T0 exactly zero and reverts on claim", async function () {
      await mintTier(user1, 1);
      await mintTier(user2, 1); // keeps W = 225 while token 0 is relabelled
      await membership.write.updateTier([0n, 0n]);
      await dist.write.depositETH({ value: D });
      await warpWindow();

      expect(await dist.read.claimableETH([[0n]])).to.equal(0n);
      await viem.assertions.revertWithCustomError(
        dist.write.claimETH([[0n]], { account: user1.account }),
        dist,
        "NothingToClaim",
      );
    });
  });

  // ── Tier resolution & timing ───────────────────────────────────────────────

  describe("tier timing", function () {
    it("does not re-price an open interval on a mid-interval tier change (frozen denominator)", async function () {
      await mintTier(user1, 2);
      await mintTier(user2, 2); // W = 200 at deposit
      await dist.write.depositETH({ value: D });
      await membership.write.updateTier([0n, 1n]); // token 0 -> T1 within the open interval
      await warpWindow();

      // F2 (settled): the interval denominator is frozen at deposit and each
      // extant token's weight basis is frozen for that interval, so a tier
      // change cannot inflate shares beyond the interval pool.
      const dueUpgraded = await dist.read.claimableETH([[0n]]);
      const duePeer = await dist.read.claimableETH([[1n]]);
      expect(dueUpgraded).to.equal(duePeer);
      expect(dueUpgraded + duePeer <= D).to.be.true;
    });

    it("honours a live tier basis for a token minted after the deposit", async function () {
      await mintTier(user1, 2);
      const peer = await viem.deployContract("MockMembershipToken", ["A", "A"]);
      void peer;
      await dist.write.depositETH({ value: D }); // freezes token 0's T2 basis
      // A token minted AFTER the deposit is read live on first touch.
      await mintTier(user2, 1);
      await dist.write.depositETH({ value: D });
      await warpWindow();
      const dueT1 = await dist.read.claimableETH([[1n]]);
      const dueT2 = await dist.read.claimableETH([[0n]]);
      expect(dueT1 > dueT2).to.be.true;
    });

    it("does not re-price retroactively after a claim", async function () {
      await mintTier(user1, 2);
      await mintTier(user2, 1);
      await dist.write.depositETH({ value: D });
      await warpWindow();

      const dueBefore = await dist.read.claimableETH([[0n]]);
      await dist.write.claimETH([[0n]], { account: user1.account });
      expect(await dist.read.claimableETH([[0n]])).to.equal(0n);
      await membership.write.updateTier([0n, 1n]);
      expect(await dist.read.claimableETH([[0n]])).to.equal(0n);
      expect(dueBefore > 0n).to.be.true;
    });
  });

  // ── Claim paths ────────────────────────────────────────────────────────────

  describe("claimETH", function () {
    beforeEach(async function () {
      await mintTier(user1, 1);
      await mintTier(user2, 2);
      await dist.write.depositETH({ value: D });
      await warpWindow();
    });

    it("pays the weighted share exactly", async function () {
      const due = await dist.read.claimableETH([[0n]]);
      const before = await publicClient.getBalance({
        address: user1.account.address,
      });
      const hash = await dist.write.claimETH([[0n]], {
        account: user1.account,
      });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await publicClient.getBalance({
        address: user1.account.address,
      });
      expect(after - before + gasUsed).to.equal(due);
    });

    it("emits ETHClaimed with the exact amount", async function () {
      const due = await dist.read.claimableETH([[0n]]);
      await viem.assertions.emitWithArgs(
        dist.write.claimETH([[0n]], { account: user1.account }),
        dist,
        "ETHClaimed",
        [getAddress(user1.account.address), [0n], due],
      );
    });

    it("reverts on an empty tokenIds array", async function () {
      await viem.assertions.revertWithCustomError(
        dist.write.claimETH([[]], { account: user1.account }),
        dist,
        "NoTokenIds",
      );
    });

    it("reverts with NotTokenOwner when the caller does not own the id", async function () {
      // Token 1 is owned by user2; user1 must not be able to claim it.
      expect((await membership.read.ownerOf([1n])).toLowerCase()).to.equal(
        user2.account.address.toLowerCase(),
      );
      await viem.assertions.revertWithCustomError(
        dist.write.claimETH([[1n]], { account: user1.account }),
        dist,
        "NotTokenOwner",
      );
    });

    it("reverts with NothingToClaim on a double claim", async function () {
      await dist.write.claimETH([[0n]], { account: user1.account });
      await viem.assertions.revertWithCustomError(
        dist.write.claimETH([[0n]], { account: user1.account }),
        dist,
        "NothingToClaim",
      );
    });

    it("pays a duplicated id only once", async function () {
      const due = await dist.read.claimableETH([[0n]]);
      const before = await publicClient.getBalance({
        address: user1.account.address,
      });
      const hash = await dist.write.claimETH([[0n, 0n]], {
        account: user1.account,
      });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
      const after = await publicClient.getBalance({
        address: user1.account.address,
      });
      expect(after - before + gasUsed).to.equal(due);
    });

    it("accumulates rewards across multiple deposits", async function () {
      const first = await dist.read.claimableETH([[0n]]);
      await dist.write.depositETH({ value: D });
      await warpWindow();
      const second = await dist.read.claimableETH([[0n]]);
      expect(second >= first).to.be.true;
      expect(second > 0n).to.be.true;
      await dist.write.claimETH([[0n]], { account: user1.account });
      expect(await dist.read.claimableETH([[0n]])).to.equal(0n);
    });
  });

  // ── ERC20 rewards ──────────────────────────────────────────────────────────

  describe("ERC20 rewards", function () {
    const AMOUNT = 650_000_000n; // 650 USDC (6dp), divisible by W = 650

    beforeEach(async function () {
      await mintTier(user1, 1);
      await mintTier(user2, 2);
      await mintTier(user3, 1);
      await mintTier(stranger, 2); // W = 650
      await usdc.write.mint([dao.account.address, AMOUNT]);
      await usdc.write.approve([dist.address, AMOUNT]);
      await dist.write.depositERC20([usdc.address, AMOUNT]);
      await warpWindow();
    });

    it("splits ERC20 rewards by tier weight", async function () {
      const w = 650n;
      expect(await dist.read.claimableERC20([usdc.address, [0n]])).to.equal(
        (AMOUNT * 225n) / w,
      );
      expect(await dist.read.claimableERC20([usdc.address, [1n]])).to.equal(
        (AMOUNT * 100n) / w,
      );
    });

    it("transfers the share and emits ERC20Claimed", async function () {
      const due = await dist.read.claimableERC20([usdc.address, [0n]]);
      const before = await usdc.read.balanceOf([user1.account.address]);
      await viem.assertions.emitWithArgs(
        dist.write.claimERC20([usdc.address, [0n]], {
          account: user1.account,
        }),
        dist,
        "ERC20Claimed",
        [getAddress(user1.account.address), getAddress(usdc.address), [0n], due],
      );
      expect(await usdc.read.balanceOf([user1.account.address])).to.equal(
        before + due,
      );
    });

    it("reverts on an empty array / non-owner / double claim", async function () {
      await viem.assertions.revertWithCustomError(
        dist.write.claimERC20([usdc.address, []], { account: user1.account }),
        dist,
        "NoTokenIds",
      );
      expect((await membership.read.ownerOf([1n])).toLowerCase()).to.equal(
        user2.account.address.toLowerCase(),
      );
      await viem.assertions.revertWithCustomError(
        dist.write.claimERC20([usdc.address, [1n]], { account: user1.account }),
        dist,
        "NotTokenOwner",
      );
      await dist.write.claimERC20([usdc.address, [0n]], {
        account: user1.account,
      });
      await viem.assertions.revertWithCustomError(
        dist.write.claimERC20([usdc.address, [0n]], { account: user1.account }),
        dist,
        "NothingToClaim",
      );
    });

    it("reverts depositERC20 on zero amount and non-owner", async function () {
      await viem.assertions.revertWithCustomError(
        dist.write.depositERC20([usdc.address, 0n]),
        dist,
        "ZeroDeposit",
      );
      await viem.assertions.revertWithCustomError(
        dist.write.depositERC20([usdc.address, 1n], {
          account: stranger.account,
        }),
        dist,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ── Views & dust ───────────────────────────────────────────────────────────

  describe("views and dust", function () {
    it("claimable views do not enforce ownership", async function () {
      await mintTier(user1, 1);
      await dist.write.depositETH({ value: D });
      await warpWindow();
      // stranger queries user1's token id via the view
      expect(await dist.read.claimableETH([[0n]])).to.be.gt(0n);
    });

    it("exposes ethDust bounded by the weighted supply", async function () {
      await mintTier(user1, 1);
      await mintTier(user2, 2);
      await dist.write.depositETH({ value: D + 1n }); // force residue
      const dust = await dist.read.ethDust();
      expect(dust < 325n).to.be.true;
    });

    it("keeps the index monotonic across deposits", async function () {
      await mintTier(user1, 1);
      await dist.write.depositETH({ value: D });
      const first = await dist.read.ethPricePerWeight();
      await dist.write.depositETH({ value: D });
      const second = await dist.read.ethPricePerWeight();
      expect(second >= first).to.be.true;
    });
  });

  // ── Conservation ───────────────────────────────────────────────────────────

  describe("conservation", function () {
    it("never lets total claimable exceed the deposited amount", async function () {
      await mintTier(user1, 1);
      await mintTier(user2, 2);
      await mintTier(user3, 1);
      await dist.write.depositETH({ value: D });
      await warpWindow();

      const sum = await dist.read.claimableETH([[0n, 1n, 2n]]);
      expect(sum <= D).to.be.true;
    });

    it("keeps the contract balance covering all outstanding claims", async function () {
      await mintTier(user1, 1);
      await mintTier(user2, 2);
      await dist.write.depositETH({ value: D });
      await warpWindow();

      const sum = await dist.read.claimableETH([[0n, 1n]]);
      const balance = await publicClient.getBalance({ address: dist.address });
      expect(sum <= balance).to.be.true;
    });
  });
});
