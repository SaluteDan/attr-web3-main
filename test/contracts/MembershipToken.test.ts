import { expect } from "chai";
import { ethers } from "hardhat";
import { MembershipToken } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MembershipToken", function () {
  let membership: MembershipToken;
  let owner: SignerWithAddress;
  let paymentReceiver: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, paymentReceiver, user1, user2] = await ethers.getSigners();

    const MembershipContract = await ethers.getContractFactory(
      "MembershipToken",
    );
    membership = await MembershipContract.deploy(
      "Platform Membership",
      "PMEM",
      owner.address,
      paymentReceiver.address,
      10000n, // maxSupply
    );
    await membership.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await membership.name()).to.equal("Platform Membership");
      expect(await membership.symbol()).to.equal("PMEM");
    });

    it("Should set correct owner", async function () {
      expect(await membership.owner()).to.equal(owner.address);
    });

    it("Should set correct payment receiver", async function () {
      expect(await membership.paymentReceiver()).to.equal(
        paymentReceiver.address,
      );
    });

    it("Should start with token ID 0", async function () {
      expect(await membership.getNextTokenId()).to.equal(0);
    });

    it("Should reject zero payment receiver and zero max supply", async function () {
      const MembershipContract = await ethers.getContractFactory("MembershipToken");

      await expect(
        MembershipContract.deploy(
          "ATTR ID",
          "ATTR#",
          owner.address,
          ethers.ZeroAddress,
          10000n,
        ),
      ).to.be.revertedWith("Invalid payment receiver");

      await expect(
        MembershipContract.deploy(
          "ATTR ID",
          "ATTR#",
          owner.address,
          paymentReceiver.address,
          0,
        ),
      ).to.be.revertedWith("Max supply must be greater than 0");
    });
  });

  describe("Tier Pricing", function () {
    it("Should allow owner to set tier prices", async function () {
      await expect(membership.setTierPrice(1, ethers.parseEther("0.1")))
        .to.emit(membership, "TierPriceUpdated")
        .withArgs(1, ethers.parseEther("0.1"));

      expect(await membership.tierPrices(1)).to.equal(ethers.parseEther("0.1"));
    });

    it("Should not allow non-owner to set tier prices", async function () {
      await expect(
        membership.connect(user1).setTierPrice(1, ethers.parseEther("0.1")),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");
    });

    it("Should allow setting multiple tier prices", async function () {
      await membership.setTierPrice(1, ethers.parseEther("0.05"));
      await membership.setTierPrice(2, ethers.parseEther("0.1"));
      await membership.setTierPrice(3, ethers.parseEther("0.2"));

      expect(await membership.tierPrices(1)).to.equal(
        ethers.parseEther("0.05"),
      );
      expect(await membership.tierPrices(2)).to.equal(ethers.parseEther("0.1"));
      expect(await membership.tierPrices(3)).to.equal(ethers.parseEther("0.2"));
    });
  });

  describe("Public Minting", function () {
    beforeEach(async function () {
      await membership.setTierPrice(1, ethers.parseEther("0.1"));
      await membership.setTierPrice(2, ethers.parseEther("0.2"));
    });

    it("Should mint membership with correct payment", async function () {
      await expect(
        membership.connect(user1).mintMembership(1, "ipfs://tier1", {
          value: ethers.parseEther("0.1"),
        }),
      )
        .to.emit(membership, "MembershipMinted")
        .withArgs(user1.address, 0, 1, "ipfs://tier1");

      expect(await membership.ownerOf(0)).to.equal(user1.address);
      expect(await membership.getTier(0)).to.equal(1);
    });

    it("Should reject insufficient payment", async function () {
      await expect(
        membership.connect(user1).mintMembership(1, "ipfs://tier1", {
          value: ethers.parseEther("0.05"),
        }),
      ).to.be.revertedWith("Insufficient payment for tier");
    });

    it("Should allow overpayment", async function () {
      await membership.connect(user1).mintMembership(1, "ipfs://tier1", {
        value: ethers.parseEther("0.15"),
      });

      expect(await membership.ownerOf(0)).to.equal(user1.address);
    });

    it("Should mint free tier (price = 0)", async function () {
      await membership.setTierPrice(0, 0);

      await membership.connect(user1).mintMembership(0, "ipfs://free");

      expect(await membership.ownerOf(0)).to.equal(user1.address);
      expect(await membership.getTier(0)).to.equal(0);
    });

    it("Should increment token IDs correctly", async function () {
      await membership.connect(user1).mintMembership(1, "ipfs://token0", {
        value: ethers.parseEther("0.1"),
      });

      await membership.connect(user2).mintMembership(1, "ipfs://token1", {
        value: ethers.parseEther("0.1"),
      });

      expect(await membership.getNextTokenId()).to.equal(2);
      expect(await membership.ownerOf(0)).to.equal(user1.address);
      expect(await membership.ownerOf(1)).to.equal(user2.address);
    });
  });

  describe("Admin Minting", function () {
    it("Should allow owner to mint for free", async function () {
      await expect(
        membership.adminMintMembership(user1.address, 1, "ipfs://admin"),
      )
        .to.emit(membership, "MembershipMinted")
        .withArgs(user1.address, 0, 1, "ipfs://admin");

      expect(await membership.ownerOf(0)).to.equal(user1.address);
    });

    it("Should not allow non-owner to admin mint", async function () {
      await expect(
        membership
          .connect(user1)
          .adminMintMembership(user2.address, 1, "ipfs://admin"),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");
    });

    it("Should enforce max supply for admin minting", async function () {
      const MembershipContract = await ethers.getContractFactory("MembershipToken");
      const small = await MembershipContract.deploy(
        "Small",
        "SML",
        owner.address,
        paymentReceiver.address,
        1,
      );
      await small.waitForDeployment();

      await small.adminMintMembership(user1.address, 1, "ipfs://1");

      await expect(
        small.adminMintMembership(user2.address, 1, "ipfs://2"),
      ).to.be.revertedWith("Max supply exceeded");
    });
  });

  describe("Batch Admin Minting", function () {
    it("Should batch mint multiple memberships", async function () {
      const recipients = [user1.address, user2.address, owner.address];
      const tiers = [1, 2, 3];
      const uris = ["ipfs://tier1", "ipfs://tier2", "ipfs://tier3"];

      await membership.adminBatchMintMemberships(recipients, tiers, uris);

      expect(await membership.ownerOf(0)).to.equal(user1.address);
      expect(await membership.ownerOf(1)).to.equal(user2.address);
      expect(await membership.ownerOf(2)).to.equal(owner.address);

      expect(await membership.getTier(0)).to.equal(1);
      expect(await membership.getTier(1)).to.equal(2);
      expect(await membership.getTier(2)).to.equal(3);
    });

    it("Should reject mismatched array lengths", async function () {
      const recipients = [user1.address, user2.address];
      const tiers = [1];
      const uris = ["ipfs://tier1", "ipfs://tier2"];

      await expect(
        membership.adminBatchMintMemberships(recipients, tiers, uris),
      ).to.be.revertedWith("Array lengths must match");
    });

    it("Should not allow non-owner to batch mint", async function () {
      await expect(
        membership
          .connect(user1)
          .adminBatchMintMemberships([user2.address], [1], ["ipfs://test"]),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");
    });

    it("Should reject batch minting beyond max supply", async function () {
      const MembershipContract = await ethers.getContractFactory("MembershipToken");
      const small = await MembershipContract.deploy(
        "Small",
        "SML",
        owner.address,
        paymentReceiver.address,
        1,
      );
      await small.waitForDeployment();

      await expect(
        small.adminBatchMintMemberships(
          [user1.address, user2.address],
          [1, 2],
          ["ipfs://1", "ipfs://2"],
        ),
      ).to.be.revertedWith("Would exceed max supply");
    });
  });

  describe("Tier Management", function () {
    beforeEach(async function () {
      await membership.adminMintMembership(user1.address, 1, "ipfs://tier1");
    });

    it("Should allow owner to update tier", async function () {
      await expect(membership.updateTier(0, 2))
        .to.emit(membership, "TierUpdated")
        .withArgs(0, 2);

      expect(await membership.getTier(0)).to.equal(2);
    });

    it("Should not allow non-owner to update tier", async function () {
      await expect(
        membership.connect(user1).updateTier(0, 2),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");
    });

    it("Should revert for non-existent token", async function () {
      await expect(membership.getTier(999)).to.be.revertedWithCustomError(
        membership,
        "ERC721NonexistentToken",
      );
    });
  });

  describe("Payment Management", function () {
    beforeEach(async function () {
      await membership.setTierPrice(1, ethers.parseEther("0.1"));
    });

    it("Should forward payments immediately to receiver", async function () {
      const initialBalance = await ethers.provider.getBalance(
        paymentReceiver.address,
      );

      await membership.connect(user1).mintMembership(1, "ipfs://tier1", {
        value: ethers.parseEther("0.1"),
      });

      // Contract should have no balance (forwarded immediately)
      const contractBalance = await ethers.provider.getBalance(
        await membership.getAddress(),
      );
      expect(contractBalance).to.equal(0n);

      // Payment receiver should have received the funds
      const finalBalance = await ethers.provider.getBalance(
        paymentReceiver.address,
      );
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("0.1"));
    });

    it("Should reject direct ETH transfers to the contract", async function () {
      // Security hardening: payments MUST flow through mintMembership so tier
      // pricing and event emission are preserved. Unsolicited ETH is rejected
      // to prevent funds getting stuck and to close a griefing vector where a
      // caller could bloat the contract balance without minting.
      await expect(
        user1.sendTransaction({
          to: await membership.getAddress(),
          value: ethers.parseEther("0.1"),
        }),
      ).to.be.revertedWith("Direct ETH transfers not allowed");
    });

    it("Should not allow non-owner to withdraw", async function () {
      await membership.connect(user1).mintMembership(1, "ipfs://tier1", {
        value: ethers.parseEther("0.1"),
      });

      await expect(
        membership.connect(user1).withdrawPayments(),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");
    });

    it("Should revert withdrawal when no funds", async function () {
      await expect(membership.withdrawPayments()).to.be.revertedWith(
        "No funds to withdraw",
      );
    });

    it("Should allow updating payment receiver", async function () {
      await membership.setPaymentReceiver(user2.address);
      expect(await membership.paymentReceiver()).to.equal(user2.address);
    });

    it("Should not allow setting zero address as payment receiver", async function () {
      await expect(
        membership.setPaymentReceiver(ethers.ZeroAddress),
      ).to.be.revertedWith("Invalid address");
    });
  });

  describe("Receive Function", function () {
    it("Should revert on direct ETH transfers (payments must route through mintMembership)", async function () {
      await expect(
        user1.sendTransaction({
          to: await membership.getAddress(),
          value: ethers.parseEther("0.5"),
        }),
      ).to.be.revertedWith("Direct ETH transfers not allowed");
    });
  });

  describe("Pause / Unpause", function () {
    it("Should allow owner to pause and unpause public minting", async function () {
      await expect(membership.pause()).to.emit(membership, "Paused").withArgs(owner.address);

      await expect(
        membership.connect(user1).mintMembership(1, "ipfs://paused"),
      ).to.be.revertedWithCustomError(membership, "EnforcedPause");

      await expect(membership.unpause()).to.emit(membership, "Unpaused").withArgs(owner.address);
      await membership.connect(user1).mintMembership(1, "ipfs://active");

      expect(await membership.ownerOf(0)).to.equal(user1.address);
    });

    it("Should not allow non-owner to pause or unpause", async function () {
      await expect(membership.connect(user1).pause()).to.be.revertedWithCustomError(
        membership,
        "OwnableUnauthorizedAccount",
      );

      await membership.pause();

      await expect(membership.connect(user1).unpause()).to.be.revertedWithCustomError(
        membership,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("Token URI", function () {
    it("Should return correct token URI", async function () {
      await membership.adminMintMembership(user1.address, 1, "ipfs://metadata");

      expect(await membership.tokenURI(0)).to.equal("ipfs://metadata");
    });
  });

  describe("Gas Optimization", function () {
    beforeEach(async function () {
      await membership.setTierPrice(1, ethers.parseEther("0.1"));
    });

    it("Should use reasonable gas for minting", async function () {
      const tx = await membership
        .connect(user1)
        .mintMembership(1, "ipfs://tier1", {
          value: ethers.parseEther("0.1"),
        });
      const receipt = await tx.wait();

      expect(receipt?.gasUsed).to.be.lessThan(200000n);
    });
  });
});
