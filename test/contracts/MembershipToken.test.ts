import { expect } from "chai";
import { ethers } from "hardhat";
import { MembershipToken } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MembershipToken", function () {
  let membership: MembershipToken;
  let owner: SignerWithAddress;
  let paymentReceiver: SignerWithAddress;
  let royaltyReceiver: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const MAX_SUPPLY = 10000n;
  const MAX_MINT_WALLET = 5n;
  const ROYALTY_FEE = 500n; // 5%
  const CONTRACT_URI = "ipfs://QmCollection";

  async function deployMembership(
    maxSupply = MAX_SUPPLY,
    maxMintPerWallet = MAX_MINT_WALLET,
  ) {
    const C = await ethers.getContractFactory("MembershipToken");
    const m = await C.deploy(
      "ATTR-MEMBER-ID",
      "ATTR#",
      owner.address,
      paymentReceiver.address,
      royaltyReceiver.address,
      ROYALTY_FEE,
      CONTRACT_URI,
      maxSupply,
      maxMintPerWallet,
    );
    await m.waitForDeployment();
    return m;
  }

  beforeEach(async function () {
    [owner, paymentReceiver, royaltyReceiver, user1, user2] =
      await ethers.getSigners();
    membership = await deployMembership();
  });

  // ── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await membership.name()).to.equal("ATTR-MEMBER-ID");
      expect(await membership.symbol()).to.equal("ATTR#");
    });

    it("Should set correct owner", async function () {
      expect(await membership.owner()).to.equal(owner.address);
    });

    it("Should set correct payment receiver", async function () {
      expect(await membership.paymentReceiver()).to.equal(
        paymentReceiver.address,
      );
    });

    it("Should set correct max supply and max mint per wallet", async function () {
      expect(await membership.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
      expect(await membership.MAX_MINT_PER_WALLET()).to.equal(MAX_MINT_WALLET);
    });

    it("Should set correct contractURI", async function () {
      expect(await membership.contractURI()).to.equal(CONTRACT_URI);
    });

    it("Should start with token ID 0", async function () {
      expect(await membership.getNextTokenId()).to.equal(0);
      expect(await membership.totalSupply()).to.equal(0);
    });

    it("Should revert on zero paymentReceiver", async function () {
      const C = await ethers.getContractFactory("MembershipToken");
      await expect(
        C.deploy(
          "X",
          "X",
          owner.address,
          ethers.ZeroAddress,
          royaltyReceiver.address,
          ROYALTY_FEE,
          "",
          MAX_SUPPLY,
          MAX_MINT_WALLET,
        ),
      ).to.be.revertedWithCustomError(C, "ZeroAddress");
    });

    it("Should revert on zero maxSupply", async function () {
      const C = await ethers.getContractFactory("MembershipToken");
      await expect(
        C.deploy(
          "X",
          "X",
          owner.address,
          paymentReceiver.address,
          royaltyReceiver.address,
          ROYALTY_FEE,
          "",
          0n,
          MAX_MINT_WALLET,
        ),
      ).to.be.revertedWithCustomError(C, "InvalidMaxSupply");
    });

    it("Should revert on invalid maxMintPerWallet", async function () {
      const C = await ethers.getContractFactory("MembershipToken");
      await expect(
        C.deploy(
          "X",
          "X",
          owner.address,
          paymentReceiver.address,
          royaltyReceiver.address,
          ROYALTY_FEE,
          "",
          10n,
          0n,
        ),
      ).to.be.revertedWithCustomError(C, "InvalidMaxMintPerWallet");

      await expect(
        C.deploy(
          "X",
          "X",
          owner.address,
          paymentReceiver.address,
          royaltyReceiver.address,
          ROYALTY_FEE,
          "",
          5n,
          6n,
        ),
      ).to.be.revertedWithCustomError(C, "InvalidMaxMintPerWallet");
    });
  });

  // ── contractURI ───────────────────────────────────────────────────────────

  describe("contractURI", function () {
    it("Should allow owner to update contractURI", async function () {
      const newURI = "ipfs://QmUpdated";
      await expect(membership.setContractURI(newURI))
        .to.emit(membership, "ContractURIUpdated")
        .withArgs(CONTRACT_URI, newURI);
      expect(await membership.contractURI()).to.equal(newURI);
    });

    it("Should reject non-owner contractURI update", async function () {
      await expect(
        membership.connect(user1).setContractURI("ipfs://hack"),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");
    });
  });

  // ── Tier Pricing ──────────────────────────────────────────────────────────

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

  // ── Public Minting ────────────────────────────────────────────────────────

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
      ).to.be.revertedWithCustomError(membership, "InsufficientPayment");
    });

    it("Should allow overpayment (contract forwards all ETH)", async function () {
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

    it("Should enforce MAX_MINT_PER_WALLET", async function () {
      const price = ethers.parseEther("0.1");
      for (let i = 0; i < Number(MAX_MINT_WALLET); i++) {
        await membership
          .connect(user1)
          .mintMembership(1, `ipfs://t${i}`, { value: price });
      }
      await expect(
        membership
          .connect(user1)
          .mintMembership(1, "ipfs://over", { value: price }),
      ).to.be.revertedWithCustomError(membership, "MaxMintPerWalletExceeded");
    });

    it("Should track getMintedCount per wallet", async function () {
      expect(await membership.getMintedCount(user1.address)).to.equal(0n);
      await membership.connect(user1).mintMembership(1, "ipfs://t", {
        value: ethers.parseEther("0.1"),
      });
      expect(await membership.getMintedCount(user1.address)).to.equal(1n);
    });

    it("Should enforce max supply", async function () {
      const small = await deployMembership(1n, 1n);
      await small.setTierPrice(1, ethers.parseEther("0.1"));
      await small.connect(user1).mintMembership(1, "ipfs://1", {
        value: ethers.parseEther("0.1"),
      });
      await expect(
        small.connect(user2).mintMembership(1, "ipfs://2", {
          value: ethers.parseEther("0.1"),
        }),
      ).to.be.revertedWithCustomError(small, "MaxSupplyExceeded");
    });

    it("Should forward payment to paymentReceiver immediately", async function () {
      const before = await ethers.provider.getBalance(paymentReceiver.address);
      await membership.connect(user1).mintMembership(1, "ipfs://t", {
        value: ethers.parseEther("0.1"),
      });
      expect(
        await ethers.provider.getBalance(await membership.getAddress()),
      ).to.equal(0n);
      const after = await ethers.provider.getBalance(paymentReceiver.address);
      expect(after - before).to.equal(ethers.parseEther("0.1"));
    });
  });

  // ── Admin Minting ─────────────────────────────────────────────────────────

  describe("Admin Minting", function () {
    it("Should allow owner to mint for free", async function () {
      await expect(
        membership.adminMintMembership(user1.address, 1, "ipfs://admin"),
      )
        .to.emit(membership, "MembershipMinted")
        .withArgs(user1.address, 0, 1, "ipfs://admin");
      expect(await membership.ownerOf(0)).to.equal(user1.address);
    });

    it("Admin mint should NOT count toward MAX_MINT_PER_WALLET", async function () {
      for (let i = 0; i < Number(MAX_MINT_WALLET) + 2; i++) {
        await membership.adminMintMembership(user1.address, 1, `ipfs://a${i}`);
      }
      expect(await membership.getMintedCount(user1.address)).to.equal(0n);
    });

    it("Should not allow non-owner to admin mint", async function () {
      await expect(
        membership
          .connect(user1)
          .adminMintMembership(user2.address, 1, "ipfs://admin"),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");
    });

    it("Should revert admin mint to zero address", async function () {
      await expect(
        membership.adminMintMembership(ethers.ZeroAddress, 1, "ipfs://a"),
      ).to.be.revertedWithCustomError(membership, "ZeroAddress");
    });

    it("Should enforce max supply for admin minting", async function () {
      const small = await deployMembership(1n, 1n);
      await small.adminMintMembership(user1.address, 1, "ipfs://1");
      await expect(
        small.adminMintMembership(user2.address, 1, "ipfs://2"),
      ).to.be.revertedWithCustomError(small, "MaxSupplyExceeded");
    });
  });

  // ── Batch Admin Minting ───────────────────────────────────────────────────

  describe("Batch Admin Minting", function () {
    it("Should batch mint multiple memberships", async function () {
      const recipients = [user1.address, user2.address, owner.address];
      const tiers = [1, 2, 3];
      const uris = ["ipfs://t1", "ipfs://t2", "ipfs://t3"];

      await membership.adminBatchMintMemberships(recipients, tiers, uris);

      expect(await membership.ownerOf(0)).to.equal(user1.address);
      expect(await membership.ownerOf(1)).to.equal(user2.address);
      expect(await membership.ownerOf(2)).to.equal(owner.address);
      expect(await membership.getTier(0)).to.equal(1);
      expect(await membership.getTier(1)).to.equal(2);
      expect(await membership.getTier(2)).to.equal(3);
    });

    it("Should reject mismatched array lengths", async function () {
      await expect(
        membership.adminBatchMintMemberships(
          [user1.address, user2.address],
          [1],
          ["ipfs://t1", "ipfs://t2"],
        ),
      ).to.be.revertedWithCustomError(membership, "ArrayLengthMismatch");
    });

    it("Should not allow non-owner to batch mint", async function () {
      await expect(
        membership
          .connect(user1)
          .adminBatchMintMemberships([user2.address], [1], ["ipfs://test"]),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");
    });

    it("Should reject batch minting beyond max supply", async function () {
      const small = await deployMembership(1n, 1n);
      await expect(
        small.adminBatchMintMemberships(
          [user1.address, user2.address],
          [1, 2],
          ["ipfs://1", "ipfs://2"],
        ),
      ).to.be.revertedWithCustomError(small, "MaxSupplyExceeded");
    });
  });

  // ── Tier Management ───────────────────────────────────────────────────────

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

  // ── Payment Receiver ──────────────────────────────────────────────────────

  describe("Payment Receiver", function () {
    it("Should allow updating payment receiver", async function () {
      await expect(membership.setPaymentReceiver(user2.address))
        .to.emit(membership, "PaymentReceiverUpdated")
        .withArgs(paymentReceiver.address, user2.address);
      expect(await membership.paymentReceiver()).to.equal(user2.address);
    });

    it("Should not allow setting zero address as payment receiver", async function () {
      await expect(
        membership.setPaymentReceiver(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(membership, "ZeroAddress");
    });

    it("Should not allow non-owner to set payment receiver", async function () {
      await expect(
        membership.connect(user1).setPaymentReceiver(user2.address),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");
    });
  });

  // ── withdrawPayments ──────────────────────────────────────────────────────

  describe("withdrawPayments", function () {
    it("Should revert withdrawal when no funds held", async function () {
      await expect(membership.withdrawPayments()).to.be.revertedWithCustomError(
        membership,
        "NothingToClaim",
      );
    });

    it("Should not allow non-owner to withdraw", async function () {
      await expect(
        membership.connect(user1).withdrawPayments(),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");
    });
  });

  // ── receive() ─────────────────────────────────────────────────────────────

  describe("receive()", function () {
    it("Should revert on direct ETH transfers", async function () {
      await expect(
        user1.sendTransaction({ to: await membership.getAddress(), value: 1n }),
      ).to.be.reverted;
    });
  });

  // ── Pause / Unpause ───────────────────────────────────────────────────────

  describe("Pause / Unpause", function () {
    it("Should allow owner to pause and unpause public minting", async function () {
      await expect(membership.pause())
        .to.emit(membership, "Paused")
        .withArgs(owner.address);

      await expect(
        membership.connect(user1).mintMembership(1, "ipfs://paused"),
      ).to.be.revertedWithCustomError(membership, "EnforcedPause");

      await expect(membership.unpause())
        .to.emit(membership, "Unpaused")
        .withArgs(owner.address);
      await membership.connect(user1).mintMembership(1, "ipfs://active");
      expect(await membership.ownerOf(0)).to.equal(user1.address);
    });

    it("Should not allow non-owner to pause or unpause", async function () {
      await expect(
        membership.connect(user1).pause(),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");

      await membership.pause();

      await expect(
        membership.connect(user1).unpause(),
      ).to.be.revertedWithCustomError(membership, "OwnableUnauthorizedAccount");
    });
  });

  // ── Token URI ─────────────────────────────────────────────────────────────

  describe("Token URI", function () {
    it("Should return correct token URI", async function () {
      await membership.adminMintMembership(user1.address, 1, "ipfs://metadata");
      expect(await membership.tokenURI(0)).to.equal("ipfs://metadata");
    });

    it("Should allow owner to update token URI", async function () {
      await membership.adminMintMembership(user1.address, 1, "ipfs://old");
      await membership.setTokenURI(0, "ipfs://new");
      expect(await membership.tokenURI(0)).to.equal("ipfs://new");
    });
  });

  // ── Royalties (ERC2981) ───────────────────────────────────────────────────

  describe("Royalties (ERC2981)", function () {
    it("Should return correct royalty info", async function () {
      await membership.adminMintMembership(user1.address, 1, "ipfs://t1");
      const salePrice = ethers.parseEther("1");
      const [receiver, amount] = await membership.royaltyInfo(0, salePrice);
      expect(receiver).to.equal(royaltyReceiver.address);
      expect(amount).to.equal((salePrice * ROYALTY_FEE) / 10000n);
    });

    it("Should support ERC2981 interface", async function () {
      expect(await membership.supportsInterface("0x2a55205a")).to.be.true;
    });
  });

  // ── Governance (ERC721Votes) ──────────────────────────────────────────────

  describe("Governance (ERC721Votes)", function () {
    beforeEach(async function () {
      await membership.adminMintMembership(user1.address, 1, "ipfs://t1");
      await membership.adminMintMembership(user1.address, 1, "ipfs://t2");
    });

    it("Should track votes after self-delegation", async function () {
      await membership.connect(user1).delegate(user1.address);
      expect(await membership.getVotes(user1.address)).to.equal(2);
    });

    it("Should allow delegation to another address", async function () {
      await membership.connect(user1).delegate(user2.address);
      expect(await membership.getVotes(user2.address)).to.equal(2);
      expect(await membership.getVotes(user1.address)).to.equal(0);
    });

    it("Should update votes on transfer", async function () {
      await membership.connect(user1).delegate(user1.address);
      await membership
        .connect(user1)
        .transferFrom(user1.address, user2.address, 0);
      expect(await membership.getVotes(user1.address)).to.equal(1);
    });
  });

  // ── supportsInterface ─────────────────────────────────────────────────────

  describe("supportsInterface", function () {
    it("Should support ERC721 interface", async function () {
      expect(await membership.supportsInterface("0x80ac58cd")).to.be.true;
    });
  });

  // ── totalSupply ───────────────────────────────────────────────────────────

  describe("totalSupply", function () {
    it("Should track total supply correctly", async function () {
      expect(await membership.totalSupply()).to.equal(0);
      await membership.adminMintMembership(user1.address, 1, "ipfs://t1");
      expect(await membership.totalSupply()).to.equal(1);
      await membership.adminMintMembership(user2.address, 1, "ipfs://t2");
      expect(await membership.totalSupply()).to.equal(2);
    });
  });
});
