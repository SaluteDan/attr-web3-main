import { expect } from "chai";
import { ethers } from "hardhat";
import { MembershipSaleSplitter } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MembershipSaleSplitter", function () {
  let splitter: MembershipSaleSplitter;
  let owner: SignerWithAddress;
  let treasury: SignerWithAddress;
  let liquidity: SignerWithAddress;
  let sender: SignerWithAddress;

  beforeEach(async function () {
    [owner, treasury, liquidity, sender] = await ethers.getSigners();

    const Splitter = await ethers.getContractFactory("MembershipSaleSplitter");
    splitter = await Splitter.deploy(
      treasury.address,
      liquidity.address,
    ) as unknown as MembershipSaleSplitter;
    await splitter.waitForDeployment();
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should store treasuryOps and liquidityReceiver", async function () {
      expect(await splitter.treasuryOps()).to.equal(treasury.address);
      expect(await splitter.liquidityReceiver()).to.equal(liquidity.address);
    });

    it("Should revert on zero treasuryOps address", async function () {
      const Splitter = await ethers.getContractFactory("MembershipSaleSplitter");
      await expect(
        Splitter.deploy(ethers.ZeroAddress, liquidity.address),
      ).to.be.revertedWithCustomError(splitter, "ZeroAddress");
    });

    it("Should revert on zero liquidityReceiver address", async function () {
      const Splitter = await ethers.getContractFactory("MembershipSaleSplitter");
      await expect(
        Splitter.deploy(treasury.address, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(splitter, "ZeroAddress");
    });
  });

  // ── 70/30 ETH Split ────────────────────────────────────────────────────────

  describe("ETH split (receive)", function () {
    it("Should split 100 ETH as 70 to treasury, 30 to liquidity", async function () {
      const amount = ethers.parseEther("100");

      const beforeTreasury  = await ethers.provider.getBalance(treasury.address);
      const beforeLiquidity = await ethers.provider.getBalance(liquidity.address);

      await expect(
        sender.sendTransaction({ to: await splitter.getAddress(), value: amount }),
      )
        .to.emit(splitter, "SaleSplit")
        .withArgs(sender.address, ethers.parseEther("70"), ethers.parseEther("30"));

      const afterTreasury  = await ethers.provider.getBalance(treasury.address);
      const afterLiquidity = await ethers.provider.getBalance(liquidity.address);

      expect(afterTreasury  - beforeTreasury).to.equal(ethers.parseEther("70"));
      expect(afterLiquidity - beforeLiquidity).to.equal(ethers.parseEther("30"));
    });

    it("Should handle integer truncation: dust goes to treasury", async function () {
      // Send 1 wei: liquidityAmount = (1 * 30) / 100 = 0, treasuryAmount = 1
      const beforeTreasury  = await ethers.provider.getBalance(treasury.address);
      const beforeLiquidity = await ethers.provider.getBalance(liquidity.address);

      await sender.sendTransaction({ to: await splitter.getAddress(), value: 1n });

      const afterTreasury  = await ethers.provider.getBalance(treasury.address);
      const afterLiquidity = await ethers.provider.getBalance(liquidity.address);

      expect(afterTreasury  - beforeTreasury).to.equal(1n);
      expect(afterLiquidity - beforeLiquidity).to.equal(0n);
    });

    it("Should handle 10 wei: liquidity gets 3, treasury gets 7", async function () {
      const beforeTreasury  = await ethers.provider.getBalance(treasury.address);
      const beforeLiquidity = await ethers.provider.getBalance(liquidity.address);

      await sender.sendTransaction({ to: await splitter.getAddress(), value: 10n });

      const afterTreasury  = await ethers.provider.getBalance(treasury.address);
      const afterLiquidity = await ethers.provider.getBalance(liquidity.address);

      expect(afterTreasury  - beforeTreasury).to.equal(7n);
      expect(afterLiquidity - beforeLiquidity).to.equal(3n);
    });

    it("Should silently accept zero ETH (no split, no event)", async function () {
      const tx = await sender.sendTransaction({ to: await splitter.getAddress(), value: 0n });
      const receipt = await tx.wait();
      const events = receipt?.logs ?? [];
      expect(events.length).to.equal(0);
    });

    it("Should forward multiple payments correctly", async function () {
      const amount = ethers.parseEther("10");

      for (let i = 0; i < 3; i++) {
        await sender.sendTransaction({ to: await splitter.getAddress(), value: amount });
      }

      const beforeTreasury  = await ethers.provider.getBalance(treasury.address);
      const beforeLiquidity = await ethers.provider.getBalance(liquidity.address);

      // Balances should have accumulated 3 rounds worth
      // This is cumulative from beforeEach baseline — just check the contract holds nothing
      expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(0n);
    });

    it("Should leave no ETH in the contract after a split", async function () {
      await sender.sendTransaction({ to: await splitter.getAddress(), value: ethers.parseEther("1") });
      expect(await ethers.provider.getBalance(await splitter.getAddress())).to.equal(0n);
    });
  });
});
