import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress, getAddress } from "viem";

const { viem, networkHelpers } = await hre.network.create();

describe("MembershipSaleSplitter", function () {
  let splitter: Awaited<
    ReturnType<typeof viem.deployContract<"MembershipSaleSplitter">>
  >;
  let owner: Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  let treasury: typeof owner;
  let liquidity: typeof owner;
  let sender: typeof owner;
  let publicClient: Awaited<ReturnType<typeof viem.getPublicClient>>;

  beforeEach(async function () {
    [owner, treasury, liquidity, sender] = await viem.getWalletClients();
    publicClient = await viem.getPublicClient();

    splitter = await viem.deployContract("MembershipSaleSplitter", [
      treasury.account.address,
      liquidity.account.address,
    ]);
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should store treasuryOps and liquidityReceiver", async function () {
      expect(await splitter.read.treasuryOps()).to.equal(
        getAddress(treasury.account.address),
      );
      expect(await splitter.read.liquidityReceiver()).to.equal(
        getAddress(liquidity.account.address),
      );
    });

    it("Should revert on zero treasuryOps address", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("MembershipSaleSplitter", [
          zeroAddress,
          liquidity.account.address,
        ]),
        splitter,
        "ZeroAddress",
      );
    });

    it("Should revert on zero liquidityReceiver address", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("MembershipSaleSplitter", [
          treasury.account.address,
          zeroAddress,
        ]),
        splitter,
        "ZeroAddress",
      );
    });
  });

  // ── 70/30 ETH Split ────────────────────────────────────────────────────────

  describe("ETH split (receive)", function () {
    it("Should split 100 ETH as 70 to treasury, 30 to liquidity", async function () {
      const amount = parseEther("100");

      const beforeTreasury = await publicClient.getBalance({
        address: treasury.account.address,
      });
      const beforeLiquidity = await publicClient.getBalance({
        address: liquidity.account.address,
      });

      await viem.assertions.emitWithArgs(
        sender.sendTransaction({ to: splitter.address, value: amount }),
        splitter,
        "SaleSplit",
        [
          getAddress(sender.account.address),
          parseEther("70"),
          parseEther("30"),
        ],
      );

      const afterTreasury = await publicClient.getBalance({
        address: treasury.account.address,
      });
      const afterLiquidity = await publicClient.getBalance({
        address: liquidity.account.address,
      });

      expect(afterTreasury - beforeTreasury).to.equal(parseEther("70"));
      expect(afterLiquidity - beforeLiquidity).to.equal(parseEther("30"));
    });

    it("Should handle integer truncation: dust goes to treasury", async function () {
      // Send 1 wei: liquidityAmount = (1 * 30) / 100 = 0, treasuryAmount = 1
      const beforeTreasury = await publicClient.getBalance({
        address: treasury.account.address,
      });
      const beforeLiquidity = await publicClient.getBalance({
        address: liquidity.account.address,
      });

      await sender.sendTransaction({ to: splitter.address, value: 1n });

      const afterTreasury = await publicClient.getBalance({
        address: treasury.account.address,
      });
      const afterLiquidity = await publicClient.getBalance({
        address: liquidity.account.address,
      });

      expect(afterTreasury - beforeTreasury).to.equal(1n);
      expect(afterLiquidity - beforeLiquidity).to.equal(0n);
    });

    it("Should handle 10 wei: liquidity gets 3, treasury gets 7", async function () {
      const beforeTreasury = await publicClient.getBalance({
        address: treasury.account.address,
      });
      const beforeLiquidity = await publicClient.getBalance({
        address: liquidity.account.address,
      });

      await sender.sendTransaction({ to: splitter.address, value: 10n });

      const afterTreasury = await publicClient.getBalance({
        address: treasury.account.address,
      });
      const afterLiquidity = await publicClient.getBalance({
        address: liquidity.account.address,
      });

      expect(afterTreasury - beforeTreasury).to.equal(7n);
      expect(afterLiquidity - beforeLiquidity).to.equal(3n);
    });

    it("Should silently accept zero ETH (no split, no event)", async function () {
      const hash = await sender.sendTransaction({
        to: splitter.address,
        value: 0n,
      });
      const receipt = await publicClient.getTransactionReceipt({ hash });
      expect(receipt.logs.length).to.equal(0);
    });

    it("Should forward multiple payments correctly", async function () {
      const amount = parseEther("10");

      for (let i = 0; i < 3; i++) {
        await sender.sendTransaction({ to: splitter.address, value: amount });
      }

      // Contract holds nothing
      expect(
        await publicClient.getBalance({ address: splitter.address }),
      ).to.equal(0n);
    });

    it("Should leave no ETH in the contract after a split", async function () {
      await sender.sendTransaction({
        to: splitter.address,
        value: parseEther("1"),
      });
      expect(
        await publicClient.getBalance({ address: splitter.address }),
      ).to.equal(0n);
    });
  });
});
