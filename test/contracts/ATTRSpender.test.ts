import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress, getAddress } from "viem";

const { viem, networkHelpers } = await hre.network.create();

describe("ATTRSpender", function () {
  let spender: Awaited<ReturnType<typeof viem.deployContract<"ATTRSpender">>>;
  let attr: Awaited<ReturnType<typeof viem.deployContract<"ATTRToken">>>;
  let owner: Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  let collection: typeof owner;
  let badCollection: typeof owner;
  let payer: typeof owner;
  let primaryReceiver: typeof owner;
  let tipReceiver: typeof owner;

  const BASE = parseEther("10");
  const TIP = parseEther("2");

  beforeEach(async function () {
    [owner, collection, badCollection, payer, primaryReceiver, tipReceiver] =
      await viem.getWalletClients();

    // Deploy ATTR token
    attr = await viem.deployContract("ATTRToken", [
      parseEther("1000000"),
      parseEther("100000"),
      owner.account.address,
    ]);

    // Deploy ATTRSpender
    spender = await viem.deployContract("ATTRSpender", [
      attr.address,
      owner.account.address,
    ]);

    // Fund the payer with ATTR and have them approve the spender
    await attr.write.transfer([payer.account.address, BASE + TIP]);
    await attr.write.approve([spender.address, BASE + TIP], {
      account: payer.account,
    });

    // Authorise the simulated collection
    await spender.write.setCollectionAuthorized([
      collection.account.address,
      true,
    ]);
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should store ATTR_TOKEN address", async function () {
      expect(await spender.read.ATTR_TOKEN()).to.equal(
        getAddress(attr.address),
      );
    });

    it("Should set correct owner", async function () {
      expect(await spender.read.owner()).to.equal(
        getAddress(owner.account.address),
      );
    });

    it("Should revert on zero attrToken address", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("ATTRSpender", [
          zeroAddress,
          owner.account.address,
        ]),
        spender,
        "ZeroAddress",
      );
    });

    it("Should revert on zero initialOwner address", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("ATTRSpender", [attr.address, zeroAddress]),
        spender,
        "OwnableInvalidOwner",
      );
    });
  });

  // ── setCollectionAuthorized ────────────────────────────────────────────────

  describe("setCollectionAuthorized", function () {
    it("Should allow owner to authorise a collection", async function () {
      await viem.assertions.emitWithArgs(
        spender.write.setCollectionAuthorized([
          badCollection.account.address,
          true,
        ]),
        spender,
        "CollectionAuthorized",
        [getAddress(badCollection.account.address), true],
      );
      expect(
        await spender.read.authorizedCollections([
          badCollection.account.address,
        ]),
      ).to.be.true;
    });

    it("Should allow owner to revoke a collection", async function () {
      await viem.assertions.emitWithArgs(
        spender.write.setCollectionAuthorized([
          collection.account.address,
          false,
        ]),
        spender,
        "CollectionAuthorized",
        [getAddress(collection.account.address), false],
      );
      expect(
        await spender.read.authorizedCollections([collection.account.address]),
      ).to.be.false;
    });

    it("Should revert on zero collection address", async function () {
      await viem.assertions.revertWithCustomError(
        spender.write.setCollectionAuthorized([zeroAddress, true]),
        spender,
        "ZeroAddress",
      );
    });

    it("Should revert if called by non-owner", async function () {
      await viem.assertions.revertWithCustomError(
        spender.write.setCollectionAuthorized(
          [collection.account.address, false],
          { account: collection.account },
        ),
        spender,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ── collectPayment ─────────────────────────────────────────────────────────

  describe("collectPayment", function () {
    it("Should transfer baseAmount to primaryReceiver and tipAmount to tipReceiver", async function () {
      const primaryBefore = await attr.read.balanceOf([
        primaryReceiver.account.address,
      ]);
      const tipBefore = await attr.read.balanceOf([
        tipReceiver.account.address,
      ]);

      await viem.assertions.emitWithArgs(
        spender.write.collectPayment(
          [
            payer.account.address,
            primaryReceiver.account.address,
            tipReceiver.account.address,
            BASE,
            TIP,
          ],
          { account: collection.account },
        ),
        spender,
        "PaymentCollected",
        [
          getAddress(collection.account.address),
          getAddress(payer.account.address),
          getAddress(primaryReceiver.account.address),
          getAddress(tipReceiver.account.address),
          BASE,
          TIP,
        ],
      );

      expect(
        await attr.read.balanceOf([primaryReceiver.account.address]),
      ).to.equal(primaryBefore + BASE);
      expect(await attr.read.balanceOf([tipReceiver.account.address])).to.equal(
        tipBefore + TIP,
      );
      expect(await attr.read.balanceOf([payer.account.address])).to.equal(0n);
    });

    it("Should work with zero tip (tipAmount = 0)", async function () {
      const amount = BASE;
      await attr.write.transfer([payer.account.address, amount]);
      await attr.write.approve([spender.address, amount], {
        account: payer.account,
      });

      const primaryBefore = await attr.read.balanceOf([
        primaryReceiver.account.address,
      ]);

      await spender.write.collectPayment(
        [
          payer.account.address,
          primaryReceiver.account.address,
          tipReceiver.account.address,
          amount,
          0n,
        ],
        { account: collection.account },
      );

      expect(
        await attr.read.balanceOf([primaryReceiver.account.address]),
      ).to.equal(primaryBefore + amount);
      expect(await attr.read.balanceOf([tipReceiver.account.address])).to.equal(
        0n,
      );
    });

    it("Should revert if called by an unauthorised collection", async function () {
      await viem.assertions.revertWithCustomError(
        spender.write.collectPayment(
          [
            payer.account.address,
            primaryReceiver.account.address,
            tipReceiver.account.address,
            BASE,
            TIP,
          ],
          { account: badCollection.account },
        ),
        spender,
        "UnauthorizedCollection",
      );
    });

    it("Should revert after collection is revoked", async function () {
      await spender.write.setCollectionAuthorized([
        collection.account.address,
        false,
      ]);
      await viem.assertions.revertWithCustomError(
        spender.write.collectPayment(
          [
            payer.account.address,
            primaryReceiver.account.address,
            tipReceiver.account.address,
            BASE,
            0n,
          ],
          { account: collection.account },
        ),
        spender,
        "UnauthorizedCollection",
      );
    });

    it("Should revert on zero payer address", async function () {
      await viem.assertions.revertWithCustomError(
        spender.write.collectPayment(
          [
            zeroAddress,
            primaryReceiver.account.address,
            tipReceiver.account.address,
            BASE,
            0n,
          ],
          { account: collection.account },
        ),
        spender,
        "ZeroAddress",
      );
    });

    it("Should revert on zero primaryReceiver address", async function () {
      await viem.assertions.revertWithCustomError(
        spender.write.collectPayment(
          [
            payer.account.address,
            zeroAddress,
            tipReceiver.account.address,
            BASE,
            0n,
          ],
          { account: collection.account },
        ),
        spender,
        "ZeroAddress",
      );
    });

    it("Should revert on zero tipReceiver when tipAmount > 0", async function () {
      await viem.assertions.revertWithCustomError(
        spender.write.collectPayment(
          [
            payer.account.address,
            primaryReceiver.account.address,
            zeroAddress,
            BASE,
            TIP,
          ],
          { account: collection.account },
        ),
        spender,
        "ZeroAddress",
      );
    });

    it("Should revert if payer has insufficient allowance", async function () {
      // New payer with no approval
      await attr.write.transfer([badCollection.account.address, BASE]);
      // badCollection has ATTR but no approval to spender
      await viem.assertions.revertWithCustomError(
        spender.write.collectPayment(
          [
            badCollection.account.address,
            primaryReceiver.account.address,
            tipReceiver.account.address,
            BASE,
            0n,
          ],
          { account: collection.account },
        ),
        attr,
        "ERC20InsufficientAllowance",
      );
    });
  });
});
