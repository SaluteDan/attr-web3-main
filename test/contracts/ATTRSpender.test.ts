import { expect } from "chai";
import { ethers } from "hardhat";
import { ATTRSpender, ATTRToken } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ATTRSpender", function () {
  let spender: ATTRSpender;
  let attr: ATTRToken;
  let owner: SignerWithAddress;
  let collection: SignerWithAddress; // simulates an authorised collection
  let badCollection: SignerWithAddress;
  let payer: SignerWithAddress;
  let primaryReceiver: SignerWithAddress;
  let tipReceiver: SignerWithAddress;

  const BASE = ethers.parseEther("10");
  const TIP = ethers.parseEther("2");

  beforeEach(async function () {
    [owner, collection, badCollection, payer, primaryReceiver, tipReceiver] =
      await ethers.getSigners();

    // Deploy ATTR token
    const ATTR = await ethers.getContractFactory("ATTRToken");
    attr = (await ATTR.deploy(
      ethers.parseEther("1000000"),
      ethers.parseEther("100000"),
      owner.address,
    )) as unknown as ATTRToken;
    await attr.waitForDeployment();

    // Deploy ATTRSpender
    const Spender = await ethers.getContractFactory("ATTRSpender");
    spender = (await Spender.deploy(
      await attr.getAddress(),
      owner.address,
    )) as unknown as ATTRSpender;
    await spender.waitForDeployment();

    // Fund the payer with ATTR and have them approve the spender
    await attr.transfer(payer.address, BASE + TIP);
    await attr.connect(payer).approve(await spender.getAddress(), BASE + TIP);

    // Authorise the simulated collection
    await spender.setCollectionAuthorized(collection.address, true);
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should store ATTR_TOKEN address", async function () {
      expect(await spender.ATTR_TOKEN()).to.equal(await attr.getAddress());
    });

    it("Should set correct owner", async function () {
      expect(await spender.owner()).to.equal(owner.address);
    });

    it("Should revert on zero attrToken address", async function () {
      const Spender = await ethers.getContractFactory("ATTRSpender");
      await expect(
        Spender.deploy(ethers.ZeroAddress, owner.address),
      ).to.be.revertedWithCustomError(spender, "ZeroAddress");
    });

    it("Should revert on zero initialOwner address", async function () {
      const Spender = await ethers.getContractFactory("ATTRSpender");
      await expect(
        Spender.deploy(await attr.getAddress(), ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(spender, "OwnableInvalidOwner");
    });
  });

  // ── setCollectionAuthorized ────────────────────────────────────────────────

  describe("setCollectionAuthorized", function () {
    it("Should allow owner to authorise a collection", async function () {
      await expect(spender.setCollectionAuthorized(badCollection.address, true))
        .to.emit(spender, "CollectionAuthorized")
        .withArgs(badCollection.address, true);
      expect(await spender.authorizedCollections(badCollection.address)).to.be
        .true;
    });

    it("Should allow owner to revoke a collection", async function () {
      await expect(spender.setCollectionAuthorized(collection.address, false))
        .to.emit(spender, "CollectionAuthorized")
        .withArgs(collection.address, false);
      expect(await spender.authorizedCollections(collection.address)).to.be
        .false;
    });

    it("Should revert on zero collection address", async function () {
      await expect(
        spender.setCollectionAuthorized(ethers.ZeroAddress, true),
      ).to.be.revertedWithCustomError(spender, "ZeroAddress");
    });

    it("Should revert if called by non-owner", async function () {
      await expect(
        spender
          .connect(collection)
          .setCollectionAuthorized(collection.address, false),
      ).to.be.revertedWithCustomError(spender, "OwnableUnauthorizedAccount");
    });
  });

  // ── collectPayment ─────────────────────────────────────────────────────────

  describe("collectPayment", function () {
    it("Should transfer baseAmount to primaryReceiver and tipAmount to tipReceiver", async function () {
      const primaryBefore = await attr.balanceOf(primaryReceiver.address);
      const tipBefore = await attr.balanceOf(tipReceiver.address);

      await expect(
        spender
          .connect(collection)
          .collectPayment(
            payer.address,
            primaryReceiver.address,
            tipReceiver.address,
            BASE,
            TIP,
          ),
      )
        .to.emit(spender, "PaymentCollected")
        .withArgs(
          collection.address,
          payer.address,
          primaryReceiver.address,
          tipReceiver.address,
          BASE,
          TIP,
        );

      expect(await attr.balanceOf(primaryReceiver.address)).to.equal(
        primaryBefore + BASE,
      );
      expect(await attr.balanceOf(tipReceiver.address)).to.equal(
        tipBefore + TIP,
      );
      expect(await attr.balanceOf(payer.address)).to.equal(0n);
    });

    it("Should work with zero tip (tipAmount = 0)", async function () {
      const amount = BASE;
      await attr.transfer(payer.address, amount);
      await attr.connect(payer).approve(await spender.getAddress(), amount);

      const primaryBefore = await attr.balanceOf(primaryReceiver.address);

      await spender
        .connect(collection)
        .collectPayment(
          payer.address,
          primaryReceiver.address,
          tipReceiver.address,
          amount,
          0n,
        );

      expect(await attr.balanceOf(primaryReceiver.address)).to.equal(
        primaryBefore + amount,
      );
      expect(await attr.balanceOf(tipReceiver.address)).to.equal(0n);
    });

    it("Should revert if called by an unauthorised collection", async function () {
      await expect(
        spender
          .connect(badCollection)
          .collectPayment(
            payer.address,
            primaryReceiver.address,
            tipReceiver.address,
            BASE,
            TIP,
          ),
      ).to.be.revertedWithCustomError(spender, "UnauthorizedCollection");
    });

    it("Should revert after collection is revoked", async function () {
      await spender.setCollectionAuthorized(collection.address, false);
      await expect(
        spender
          .connect(collection)
          .collectPayment(
            payer.address,
            primaryReceiver.address,
            tipReceiver.address,
            BASE,
            0n,
          ),
      ).to.be.revertedWithCustomError(spender, "UnauthorizedCollection");
    });

    it("Should revert on zero payer address", async function () {
      await expect(
        spender
          .connect(collection)
          .collectPayment(
            ethers.ZeroAddress,
            primaryReceiver.address,
            tipReceiver.address,
            BASE,
            0n,
          ),
      ).to.be.revertedWithCustomError(spender, "ZeroAddress");
    });

    it("Should revert on zero primaryReceiver address", async function () {
      await expect(
        spender
          .connect(collection)
          .collectPayment(
            payer.address,
            ethers.ZeroAddress,
            tipReceiver.address,
            BASE,
            0n,
          ),
      ).to.be.revertedWithCustomError(spender, "ZeroAddress");
    });

    it("Should revert on zero tipReceiver when tipAmount > 0", async function () {
      await expect(
        spender
          .connect(collection)
          .collectPayment(
            payer.address,
            primaryReceiver.address,
            ethers.ZeroAddress,
            BASE,
            TIP,
          ),
      ).to.be.revertedWithCustomError(spender, "ZeroAddress");
    });

    it("Should revert if payer has insufficient allowance", async function () {
      // New payer with no approval
      await attr.transfer(badCollection.address, BASE);
      // badCollection.address has ATTR but no approval to spender
      await spender.setCollectionAuthorized(collection.address, true);
      await expect(
        spender
          .connect(collection)
          .collectPayment(
            badCollection.address,
            primaryReceiver.address,
            tipReceiver.address,
            BASE,
            0n,
          ),
      ).to.be.revertedWithCustomError(attr, "ERC20InsufficientAllowance");
    });
  });
});
