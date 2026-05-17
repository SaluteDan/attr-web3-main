import { expect } from "chai";
import { ethers } from "hardhat";
import { PaymentSplitter } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PaymentSplitter", function () {
  let splitter: PaymentSplitter;
  let payee1: SignerWithAddress;
  let payee2: SignerWithAddress;
  let payee3: SignerWithAddress;
  let sender: SignerWithAddress;

  beforeEach(async function () {
    [sender, payee1, payee2, payee3] = await ethers.getSigners();

    const SplitterContract = await ethers.getContractFactory("PaymentSplitter");
    splitter = await SplitterContract.deploy(
      [payee1.address, payee2.address],
      [60, 40], // 60% to payee1, 40% to payee2
    );
    await splitter.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set correct total shares", async function () {
      expect(await splitter.totalShares()).to.equal(100);
    });

    it("Should set correct shares for payees", async function () {
      expect(await splitter.shares(payee1.address)).to.equal(60);
      expect(await splitter.shares(payee2.address)).to.equal(40);
    });

    it("Should track payees correctly", async function () {
      expect(await splitter.payee(0)).to.equal(payee1.address);
      expect(await splitter.payee(1)).to.equal(payee2.address);
    });

    it("Should revert if arrays have different lengths", async function () {
      const SplitterContract =
        await ethers.getContractFactory("PaymentSplitter");
      await expect(
        SplitterContract.deploy([payee1.address], [50, 50]),
      ).to.be.revertedWithCustomError(splitter, "ArrayLengthMismatch");
    });

    it("Should revert if no payees provided", async function () {
      const SplitterContract =
        await ethers.getContractFactory("PaymentSplitter");
      await expect(
        SplitterContract.deploy([], []),
      ).to.be.revertedWithCustomError(splitter, "NoPayees");
    });

    it("Should revert if payee is zero address", async function () {
      const SplitterContract =
        await ethers.getContractFactory("PaymentSplitter");
      await expect(
        SplitterContract.deploy([ethers.ZeroAddress], [100]),
      ).to.be.revertedWithCustomError(splitter, "ZeroAddress");
    });

    it("Should revert if shares are zero", async function () {
      const SplitterContract =
        await ethers.getContractFactory("PaymentSplitter");
      await expect(
        SplitterContract.deploy([payee1.address], [0]),
      ).to.be.revertedWithCustomError(splitter, "InvalidShare");
    });

    it("Should revert if any payee has zero shares", async function () {
      const SplitterContract =
        await ethers.getContractFactory("PaymentSplitter");
      await expect(
        SplitterContract.deploy([payee1.address, payee2.address], [50, 0]),
      ).to.be.revertedWithCustomError(splitter, "InvalidShare");
    });

    it("Should revert if duplicate payees", async function () {
      const SplitterContract =
        await ethers.getContractFactory("PaymentSplitter");
      await expect(
        SplitterContract.deploy([payee1.address, payee1.address], [50, 50]),
      ).to.be.revertedWithCustomError(splitter, "DuplicatePayee");
    });
  });

  describe("ETH Payment Reception", function () {
    it("Should receive ETH payments", async function () {
      const amount = ethers.parseEther("1");

      await expect(
        sender.sendTransaction({
          to: await splitter.getAddress(),
          value: amount,
        }),
      )
        .to.emit(splitter, "PaymentReceived")
        .withArgs(sender.address, amount);

      expect(
        await ethers.provider.getBalance(await splitter.getAddress()),
      ).to.equal(amount);
    });

    it("Should accept multiple payments", async function () {
      await sender.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther("1"),
      });

      await sender.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther("0.5"),
      });

      expect(
        await ethers.provider.getBalance(await splitter.getAddress()),
      ).to.equal(ethers.parseEther("1.5"));
    });
  });

  describe("ETH Release", function () {
    beforeEach(async function () {
      await sender.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther("10"),
      });
    });

    it("Should calculate releasable amount correctly", async function () {
      expect(await splitter.releasable(payee1.address)).to.equal(
        ethers.parseEther("6"),
      ); // 60%
      expect(await splitter.releasable(payee2.address)).to.equal(
        ethers.parseEther("4"),
      ); // 40%
    });

    it("Should release ETH to payee", async function () {
      const initialBalance = await ethers.provider.getBalance(payee1.address);

      await expect(splitter.release(payee1.address))
        .to.emit(splitter, "PaymentReleased")
        .withArgs(payee1.address, ethers.parseEther("6"));

      const finalBalance = await ethers.provider.getBalance(payee1.address);
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("6"));
    });

    it("Should update released tracking", async function () {
      await splitter.release(payee1.address);

      expect(await splitter.released(payee1.address)).to.equal(
        ethers.parseEther("6"),
      );
      expect(await splitter.totalReleased()).to.equal(ethers.parseEther("6"));
    });

    it("Should allow multiple releases", async function () {
      await splitter.release(payee1.address);
      await splitter.release(payee2.address);

      expect(await splitter.totalReleased()).to.equal(ethers.parseEther("10"));
    });

    it("Should calculate correct releasable after partial release", async function () {
      await splitter.release(payee1.address);

      await sender.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther("10"),
      });

      expect(await splitter.releasable(payee1.address)).to.equal(
        ethers.parseEther("6"),
      );
    });

    it("Should revert if account has no shares", async function () {
      await expect(
        splitter.release(payee3.address),
      ).to.be.revertedWithCustomError(splitter, "InvalidPayee");
    });

    it("Should revert if account is not due payment", async function () {
      await splitter.release(payee1.address);

      await expect(
        splitter.release(payee1.address),
      ).to.be.revertedWithCustomError(splitter, "NoPaymentDue");
    });
  });

  describe("ERC20 Payment", function () {
    let token: any;

    beforeEach(async function () {
      const TokenContract = await ethers.getContractFactory("ATTRToken");
      token = await TokenContract.deploy(
        ethers.parseEther("1000000"),
        ethers.parseEther("100000"),
        sender.address,
      );
      await token.waitForDeployment();

      await token.transfer(
        await splitter.getAddress(),
        ethers.parseEther("1000"),
      );
    });

    it("Should calculate ERC20 releasable amount", async function () {
      expect(
        await splitter["releasable(address,address)"](
          token.getAddress(),
          payee1.address,
        ),
      ).to.equal(ethers.parseEther("600"));
      expect(
        await splitter["releasable(address,address)"](
          token.getAddress(),
          payee2.address,
        ),
      ).to.equal(ethers.parseEther("400"));
    });

    it("Should release ERC20 tokens", async function () {
      await expect(
        splitter["release(address,address)"](
          token.getAddress(),
          payee1.address,
        ),
      )
        .to.emit(splitter, "ERC20PaymentReleased")
        .withArgs(
          await token.getAddress(),
          payee1.address,
          ethers.parseEther("600"),
        );

      expect(await token.balanceOf(payee1.address)).to.equal(
        ethers.parseEther("600"),
      );
    });

    it("Should track ERC20 releases separately", async function () {
      await splitter["release(address,address)"](
        token.getAddress(),
        payee1.address,
      );

      expect(
        await splitter["released(address,address)"](
          token.getAddress(),
          payee1.address,
        ),
      ).to.equal(ethers.parseEther("600"));

      expect(
        await splitter["totalReleased(address)"](token.getAddress()),
      ).to.equal(ethers.parseEther("600"));
    });

    it("Should handle multiple ERC20 releases", async function () {
      await splitter["release(address,address)"](
        token.getAddress(),
        payee1.address,
      );
      await splitter["release(address,address)"](
        token.getAddress(),
        payee2.address,
      );

      expect(
        await splitter["totalReleased(address)"](token.getAddress()),
      ).to.equal(ethers.parseEther("1000"));
    });
  });

  describe("Complex Split Scenarios", function () {
    it("Should handle uneven splits correctly", async function () {
      const SplitterContract =
        await ethers.getContractFactory("PaymentSplitter");
      const unevenSplitter = await SplitterContract.deploy(
        [payee1.address, payee2.address, payee3.address],
        [50, 30, 20],
      );

      await sender.sendTransaction({
        to: await unevenSplitter.getAddress(),
        value: ethers.parseEther("100"),
      });

      expect(await unevenSplitter.releasable(payee1.address)).to.equal(
        ethers.parseEther("50"),
      );
      expect(await unevenSplitter.releasable(payee2.address)).to.equal(
        ethers.parseEther("30"),
      );
      expect(await unevenSplitter.releasable(payee3.address)).to.equal(
        ethers.parseEther("20"),
      );
    });

    it("Should handle very small payments", async function () {
      await sender.sendTransaction({
        to: await splitter.getAddress(),
        value: 100n,
      });

      expect(await splitter.releasable(payee1.address)).to.equal(60n);
      expect(await splitter.releasable(payee2.address)).to.equal(40n);
    });
  });

  describe("Gas Optimization", function () {
    beforeEach(async function () {
      await sender.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther("10"),
      });
    });

    it("Should use reasonable gas for release", async function () {
      const tx = await splitter.release(payee1.address);
      const receipt = await tx.wait();

      expect(receipt?.gasUsed).to.be.lessThan(100000n);
    });
  });

  describe("Batch Release Functions", function () {
    beforeEach(async function () {
      await sender.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther("10"),
      });
    });

    it("Should release all ETH payments at once", async function () {
      const initialBalance1 = await ethers.provider.getBalance(payee1.address);
      const initialBalance2 = await ethers.provider.getBalance(payee2.address);

      await expect(splitter.releaseAll())
        .to.emit(splitter, "BatchPaymentReleased")
        .withArgs(ethers.parseEther("10"), 2);

      const finalBalance1 = await ethers.provider.getBalance(payee1.address);
      const finalBalance2 = await ethers.provider.getBalance(payee2.address);

      expect(finalBalance1 - initialBalance1).to.equal(ethers.parseEther("6"));
      expect(finalBalance2 - initialBalance2).to.equal(ethers.parseEther("4"));
    });

    it("Should handle partial releases in batch", async function () {
      // Release to one payee first
      await splitter.release(payee1.address);

      // Add more funds
      await sender.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther("5"),
      });

      await expect(splitter.releaseAll())
        .to.emit(splitter, "BatchPaymentReleased")
        .withArgs(ethers.parseEther("9"), 2); // 3 + 6 = 9 ETH total
    });

    it("Should not emit batch event if no payments to release", async function () {
      // Release all first
      await splitter.releaseAll();

      // Try to release again
      const tx = await splitter.releaseAll();
      const receipt = await tx.wait();

      // Should not emit BatchPaymentReleased event
      const batchEvents = receipt?.logs.filter(
        (log) =>
          log.topics[0] ===
          splitter.interface.getEvent("BatchPaymentReleased").topicHash,
      );
      expect(batchEvents?.length).to.equal(0);
    });
  });

  describe("Automation Helper Functions", function () {
    beforeEach(async function () {
      await sender.sendTransaction({
        to: await splitter.getAddress(),
        value: ethers.parseEther("10"),
      });
    });

    it("Should return payees with pending payments", async function () {
      const pendingPayees = await splitter.getPayeesWithPendingPayments();
      expect(pendingPayees).to.deep.equal([payee1.address, payee2.address]);
    });

    it("Should return empty array when no pending payments", async function () {
      await splitter.releaseAll();
      const pendingPayees = await splitter.getPayeesWithPendingPayments();
      expect(pendingPayees).to.deep.equal([]);
    });

    it("Should calculate total pending payments", async function () {
      const totalPending = await splitter.totalPendingPayments();
      expect(totalPending).to.equal(ethers.parseEther("10"));
    });

    it("Should return all payees and shares", async function () {
      const [payees, shares] = await splitter.getAllPayees();
      expect(payees).to.deep.equal([payee1.address, payee2.address]);
      expect(shares).to.deep.equal([60n, 40n]);
    });

    it("Should return correct payee count", async function () {
      expect(await splitter.payeeCount()).to.equal(2);
    });
  });

  describe("Payee Management", function () {
    it("Should allow owner to add new payee", async function () {
      await expect(splitter.addPayee(payee3.address, 20))
        .to.emit(splitter, "PayeeAdded")
        .withArgs(payee3.address, 20);

      expect(await splitter.shares(payee3.address)).to.equal(20);
      expect(await splitter.totalShares()).to.equal(120);
      expect(await splitter.payeeCount()).to.equal(3);
    });

    it("Should allow owner to update payee shares", async function () {
      await expect(splitter.updatePayeeShares(payee1.address, 70))
        .to.emit(splitter, "PayeeUpdated")
        .withArgs(payee1.address, 70);

      expect(await splitter.shares(payee1.address)).to.equal(70);
      expect(await splitter.totalShares()).to.equal(110);
    });

    it("Should revert if non-owner tries to add payee", async function () {
      await expect(
        splitter.connect(payee1).addPayee(payee3.address, 20),
      ).to.be.revertedWithCustomError(splitter, "OwnableUnauthorizedAccount");
    });

    it("Should revert if non-owner tries to update shares", async function () {
      await expect(
        splitter.connect(payee1).updatePayeeShares(payee1.address, 70),
      ).to.be.revertedWithCustomError(splitter, "OwnableUnauthorizedAccount");
    });

    it("Should revert when updating non-existent payee", async function () {
      await expect(
        splitter.updatePayeeShares(payee3.address, 50),
      ).to.be.revertedWithCustomError(splitter, "InvalidPayee");
    });

    it("Should revert when updating to zero shares", async function () {
      await expect(
        splitter.updatePayeeShares(payee1.address, 0),
      ).to.be.revertedWithCustomError(splitter, "InvalidShare");
    });
  });

  describe("ERC20 Batch Release", function () {
    let token: any;

    beforeEach(async function () {
      const TokenContract = await ethers.getContractFactory("ATTRToken");
      token = await TokenContract.deploy(
        ethers.parseEther("1000000"),
        ethers.parseEther("100000"),
        sender.address,
      );
      await token.waitForDeployment();

      await token.transfer(
        await splitter.getAddress(),
        ethers.parseEther("1000"),
      );
    });

    it("Should release all ERC20 payments at once", async function () {
      await expect(splitter["releaseAll(address)"](await token.getAddress()))
        .to.emit(splitter, "BatchPaymentReleased")
        .withArgs(ethers.parseEther("1000"), 2);

      expect(await token.balanceOf(payee1.address)).to.equal(
        ethers.parseEther("600"),
      );
      expect(await token.balanceOf(payee2.address)).to.equal(
        ethers.parseEther("400"),
      );
    });

    it("Should return payees with pending ERC20 payments", async function () {
      const pendingPayees = await splitter[
        "getPayeesWithPendingPayments(address)"
      ](await token.getAddress());
      expect(pendingPayees).to.deep.equal([payee1.address, payee2.address]);
    });

    it("Should calculate total pending ERC20 payments", async function () {
      const totalPending = await splitter["totalPendingPayments(address)"](
        await token.getAddress(),
      );
      expect(totalPending).to.equal(ethers.parseEther("1000"));
    });
  });
});
