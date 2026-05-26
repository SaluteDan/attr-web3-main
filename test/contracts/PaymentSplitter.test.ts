import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress, getAddress } from "viem";

const { viem, networkHelpers } = await hre.network.create();

describe("PaymentSplitter", function () {
  let splitter: Awaited<
    ReturnType<typeof viem.deployContract<"PaymentSplitter">>
  >;
  let payee1: Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  let payee2: typeof payee1;
  let payee3: typeof payee1;
  let sender: typeof payee1;
  let publicClient: Awaited<ReturnType<typeof viem.getPublicClient>>;

  beforeEach(async function () {
    [sender, payee1, payee2, payee3] = await viem.getWalletClients();
    publicClient = await viem.getPublicClient();

    splitter = await viem.deployContract("PaymentSplitter", [
      [payee1.account.address, payee2.account.address],
      [60n, 40n], // 60% to payee1, 40% to payee2
    ]);
  });

  describe("Deployment", function () {
    it("Should set correct total shares", async function () {
      expect(await splitter.read.totalShares()).to.equal(100n);
    });

    it("Should set correct shares for payees", async function () {
      expect(await splitter.read.shares([payee1.account.address])).to.equal(
        60n,
      );
      expect(await splitter.read.shares([payee2.account.address])).to.equal(
        40n,
      );
    });

    it("Should track payees correctly", async function () {
      expect(await splitter.read.payee([0n])).to.equal(
        getAddress(payee1.account.address),
      );
      expect(await splitter.read.payee([1n])).to.equal(
        getAddress(payee2.account.address),
      );
    });

    it("Should revert if arrays have different lengths", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("PaymentSplitter", [
          [payee1.account.address],
          [50n, 50n],
        ]),
        splitter,
        "ArrayLengthMismatch",
      );
    });

    it("Should revert if no payees provided", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("PaymentSplitter", [[], []]),
        splitter,
        "NoPayees",
      );
    });

    it("Should revert if payee is zero address", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("PaymentSplitter", [[zeroAddress], [100n]]),
        splitter,
        "ZeroAddress",
      );
    });

    it("Should revert if shares are zero", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("PaymentSplitter", [
          [payee1.account.address],
          [0n],
        ]),
        splitter,
        "InvalidShare",
      );
    });

    it("Should revert if any payee has zero shares", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("PaymentSplitter", [
          [payee1.account.address, payee2.account.address],
          [50n, 0n],
        ]),
        splitter,
        "InvalidShare",
      );
    });

    it("Should revert if duplicate payees", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("PaymentSplitter", [
          [payee1.account.address, payee1.account.address],
          [50n, 50n],
        ]),
        splitter,
        "DuplicatePayee",
      );
    });
  });

  describe("ETH Payment Reception", function () {
    it("Should receive ETH payments", async function () {
      const amount = parseEther("1");

      await viem.assertions.emitWithArgs(
        sender.sendTransaction({
          to: splitter.address,
          value: amount,
        }),
        splitter,
        "PaymentReceived",
        [getAddress(sender.account.address), amount],
      );

      expect(
        await publicClient.getBalance({ address: splitter.address }),
      ).to.equal(amount);
    });

    it("Should accept multiple payments", async function () {
      await sender.sendTransaction({
        to: splitter.address,
        value: parseEther("1"),
      });

      await sender.sendTransaction({
        to: splitter.address,
        value: parseEther("0.5"),
      });

      expect(
        await publicClient.getBalance({ address: splitter.address }),
      ).to.equal(parseEther("1.5"));
    });
  });

  describe("ETH Release", function () {
    beforeEach(async function () {
      await sender.sendTransaction({
        to: splitter.address,
        value: parseEther("10"),
      });
    });

    it("Should calculate releasable amount correctly", async function () {
      expect(await splitter.read.releasable([payee1.account.address])).to.equal(
        parseEther("6"),
      ); // 60%
      expect(await splitter.read.releasable([payee2.account.address])).to.equal(
        parseEther("4"),
      ); // 40%
    });

    it("Should release ETH to payee", async function () {
      const initialBalance = await publicClient.getBalance({
        address: payee1.account.address,
      });

      await viem.assertions.emitWithArgs(
        splitter.write.release([payee1.account.address]),
        splitter,
        "PaymentReleased",
        [getAddress(payee1.account.address), parseEther("6")],
      );

      const finalBalance = await publicClient.getBalance({
        address: payee1.account.address,
      });
      expect(finalBalance - initialBalance).to.equal(parseEther("6"));
    });

    it("Should update released tracking", async function () {
      await splitter.write.release([payee1.account.address]);

      expect(await splitter.read.released([payee1.account.address])).to.equal(
        parseEther("6"),
      );
      expect(await splitter.read.totalReleased()).to.equal(parseEther("6"));
    });

    it("Should allow multiple releases", async function () {
      await splitter.write.release([payee1.account.address]);
      await splitter.write.release([payee2.account.address]);

      expect(await splitter.read.totalReleased()).to.equal(parseEther("10"));
    });

    it("Should calculate correct releasable after partial release", async function () {
      await splitter.write.release([payee1.account.address]);

      await sender.sendTransaction({
        to: splitter.address,
        value: parseEther("10"),
      });

      expect(await splitter.read.releasable([payee1.account.address])).to.equal(
        parseEther("6"),
      );
    });

    it("Should revert if account has no shares", async function () {
      await viem.assertions.revertWithCustomError(
        splitter.write.release([payee3.account.address]),
        splitter,
        "InvalidPayee",
      );
    });

    it("Should revert if account is not due payment", async function () {
      await splitter.write.release([payee1.account.address]);

      await viem.assertions.revertWithCustomError(
        splitter.write.release([payee1.account.address]),
        splitter,
        "NoPaymentDue",
      );
    });
  });

  describe("ERC20 Payment", function () {
    let token: Awaited<ReturnType<typeof viem.deployContract<"ATTRToken">>>;

    beforeEach(async function () {
      token = await viem.deployContract("ATTRToken", [
        parseEther("1000000"),
        parseEther("100000"),
        sender.account.address,
      ]);

      await token.write.transfer([splitter.address, parseEther("1000")], {
        account: sender.account,
      });
    });

    it("Should calculate ERC20 releasable amount", async function () {
      expect(
        await splitter.read.releasable([token.address, payee1.account.address]),
      ).to.equal(parseEther("600"));
      expect(
        await splitter.read.releasable([token.address, payee2.account.address]),
      ).to.equal(parseEther("400"));
    });

    it("Should release ERC20 tokens", async function () {
      await viem.assertions.emitWithArgs(
        splitter.write.release([token.address, payee1.account.address]),
        splitter,
        "ERC20PaymentReleased",
        [
          getAddress(token.address),
          getAddress(payee1.account.address),
          parseEther("600"),
        ],
      );

      expect(await token.read.balanceOf([payee1.account.address])).to.equal(
        parseEther("600"),
      );
    });

    it("Should track ERC20 releases separately", async function () {
      await splitter.write.release([token.address, payee1.account.address]);

      expect(
        await splitter.read.released([token.address, payee1.account.address]),
      ).to.equal(parseEther("600"));

      expect(await splitter.read.totalReleased([token.address])).to.equal(
        parseEther("600"),
      );
    });

    it("Should handle multiple ERC20 releases", async function () {
      await splitter.write.release([token.address, payee1.account.address]);
      await splitter.write.release([token.address, payee2.account.address]);

      expect(await splitter.read.totalReleased([token.address])).to.equal(
        parseEther("1000"),
      );
    });
  });

  describe("Complex Split Scenarios", function () {
    it("Should handle uneven splits correctly", async function () {
      const unevenSplitter = await viem.deployContract("PaymentSplitter", [
        [
          payee1.account.address,
          payee2.account.address,
          payee3.account.address,
        ],
        [50n, 30n, 20n],
      ]);

      await sender.sendTransaction({
        to: unevenSplitter.address,
        value: parseEther("100"),
      });

      expect(
        await unevenSplitter.read.releasable([payee1.account.address]),
      ).to.equal(parseEther("50"));
      expect(
        await unevenSplitter.read.releasable([payee2.account.address]),
      ).to.equal(parseEther("30"));
      expect(
        await unevenSplitter.read.releasable([payee3.account.address]),
      ).to.equal(parseEther("20"));
    });

    it("Should handle very small payments", async function () {
      await sender.sendTransaction({
        to: splitter.address,
        value: 100n,
      });

      expect(await splitter.read.releasable([payee1.account.address])).to.equal(
        60n,
      );
      expect(await splitter.read.releasable([payee2.account.address])).to.equal(
        40n,
      );
    });
  });

  describe("Gas Optimization", function () {
    beforeEach(async function () {
      await sender.sendTransaction({
        to: splitter.address,
        value: parseEther("10"),
      });
    });

    it("Should use reasonable gas for release", async function () {
      const hash = await splitter.write.release([payee1.account.address]);
      const receipt = await publicClient.getTransactionReceipt({ hash });

      expect(receipt.gasUsed).to.be.lessThan(100000n);
    });
  });

  describe("Batch Release Functions", function () {
    beforeEach(async function () {
      await sender.sendTransaction({
        to: splitter.address,
        value: parseEther("10"),
      });
    });

    it("Should release all ETH payments at once", async function () {
      const initialBalance1 = await publicClient.getBalance({
        address: payee1.account.address,
      });
      const initialBalance2 = await publicClient.getBalance({
        address: payee2.account.address,
      });

      await viem.assertions.emitWithArgs(
        splitter.write.releaseAll(),
        splitter,
        "BatchPaymentReleased",
        [parseEther("10"), 2n],
      );

      const finalBalance1 = await publicClient.getBalance({
        address: payee1.account.address,
      });
      const finalBalance2 = await publicClient.getBalance({
        address: payee2.account.address,
      });

      expect(finalBalance1 - initialBalance1).to.equal(parseEther("6"));
      expect(finalBalance2 - initialBalance2).to.equal(parseEther("4"));
    });

    it("Should handle partial releases in batch", async function () {
      // Release to one payee first
      await splitter.write.release([payee1.account.address]);

      // Add more funds
      await sender.sendTransaction({
        to: splitter.address,
        value: parseEther("5"),
      });

      await viem.assertions.emitWithArgs(
        splitter.write.releaseAll(),
        splitter,
        "BatchPaymentReleased",
        [parseEther("9"), 2n], // 3 + 6 = 9 ETH total
      );
    });

    it("Should not emit batch event if no payments to release", async function () {
      // Release all first
      await splitter.write.releaseAll();

      // Try to release again — should not emit BatchPaymentReleased
      const hash = await splitter.write.releaseAll();
      const receipt = await publicClient.getTransactionReceipt({ hash });

      // Check logs do not contain BatchPaymentReleased
      const batchEvents = receipt.logs.filter(
        (log) => log.topics[0] === "0x" + "BatchPaymentReleased",
      );
      // Simpler: just verify no events emitted (receipt should have 0 logs)
      expect(receipt.logs.length).to.equal(0);
    });
  });

  describe("Automation Helper Functions", function () {
    beforeEach(async function () {
      await sender.sendTransaction({
        to: splitter.address,
        value: parseEther("10"),
      });
    });

    it("Should return payees with pending payments", async function () {
      const pendingPayees = await splitter.read.getPayeesWithPendingPayments();
      expect(pendingPayees.map((a) => getAddress(a))).to.deep.equal([
        getAddress(payee1.account.address),
        getAddress(payee2.account.address),
      ]);
    });

    it("Should return empty array when no pending payments", async function () {
      await splitter.write.releaseAll();
      const pendingPayees = await splitter.read.getPayeesWithPendingPayments();
      expect(pendingPayees).to.deep.equal([]);
    });

    it("Should calculate total pending payments", async function () {
      const totalPending = await splitter.read.totalPendingPayments();
      expect(totalPending).to.equal(parseEther("10"));
    });

    it("Should return all payees and shares", async function () {
      const [payees, shares] = await splitter.read.getAllPayees();
      expect(payees.map((a) => getAddress(a))).to.deep.equal([
        getAddress(payee1.account.address),
        getAddress(payee2.account.address),
      ]);
      expect([...shares]).to.deep.equal([60n, 40n]);
    });

    it("Should return correct payee count", async function () {
      expect(await splitter.read.payeeCount()).to.equal(2n);
    });
  });

  describe("Payee Management", function () {
    it("Should allow owner to add new payee", async function () {
      await viem.assertions.emitWithArgs(
        splitter.write.addPayee([payee3.account.address, 20n]),
        splitter,
        "PayeeAdded",
        [getAddress(payee3.account.address), 20n],
      );

      expect(await splitter.read.shares([payee3.account.address])).to.equal(
        20n,
      );
      expect(await splitter.read.totalShares()).to.equal(120n);
      expect(await splitter.read.payeeCount()).to.equal(3n);
    });

    it("Should allow owner to update payee shares", async function () {
      await viem.assertions.emitWithArgs(
        splitter.write.updatePayeeShares([payee1.account.address, 70n]),
        splitter,
        "PayeeUpdated",
        [getAddress(payee1.account.address), 70n],
      );

      expect(await splitter.read.shares([payee1.account.address])).to.equal(
        70n,
      );
      expect(await splitter.read.totalShares()).to.equal(110n);
    });

    it("Should revert if non-owner tries to add payee", async function () {
      await viem.assertions.revertWithCustomError(
        splitter.write.addPayee([payee3.account.address, 20n], {
          account: payee1.account,
        }),
        splitter,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should revert if non-owner tries to update shares", async function () {
      await viem.assertions.revertWithCustomError(
        splitter.write.updatePayeeShares([payee1.account.address, 70n], {
          account: payee1.account,
        }),
        splitter,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should revert when updating non-existent payee", async function () {
      await viem.assertions.revertWithCustomError(
        splitter.write.updatePayeeShares([payee3.account.address, 50n]),
        splitter,
        "InvalidPayee",
      );
    });

    it("Should revert when updating to zero shares", async function () {
      await viem.assertions.revertWithCustomError(
        splitter.write.updatePayeeShares([payee1.account.address, 0n]),
        splitter,
        "InvalidShare",
      );
    });
  });

  describe("ERC20 Batch Release", function () {
    let token: Awaited<ReturnType<typeof viem.deployContract<"ATTRToken">>>;

    beforeEach(async function () {
      token = await viem.deployContract("ATTRToken", [
        parseEther("1000000"),
        parseEther("100000"),
        sender.account.address,
      ]);

      await token.write.transfer([splitter.address, parseEther("1000")], {
        account: sender.account,
      });
    });

    it("Should release all ERC20 payments at once", async function () {
      await viem.assertions.emitWithArgs(
        splitter.write.releaseAll([token.address]),
        splitter,
        "BatchPaymentReleased",
        [parseEther("1000"), 2n],
      );

      expect(await token.read.balanceOf([payee1.account.address])).to.equal(
        parseEther("600"),
      );
      expect(await token.read.balanceOf([payee2.account.address])).to.equal(
        parseEther("400"),
      );
    });

    it("Should return payees with pending ERC20 payments", async function () {
      const pendingPayees = await splitter.read.getPayeesWithPendingPayments([
        token.address,
      ]);
      expect(pendingPayees.map((a) => getAddress(a))).to.deep.equal([
        getAddress(payee1.account.address),
        getAddress(payee2.account.address),
      ]);
    });

    it("Should calculate total pending ERC20 payments", async function () {
      const totalPending = await splitter.read.totalPendingPayments([
        token.address,
      ]);
      expect(totalPending).to.equal(parseEther("1000"));
    });
  });
});
