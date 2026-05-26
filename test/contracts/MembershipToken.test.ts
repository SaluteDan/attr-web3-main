import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress, getAddress } from "viem";

const { viem, networkHelpers } = await hre.network.create();

describe("MembershipToken", function () {
  let membership: Awaited<
    ReturnType<typeof viem.deployContract<"MembershipToken">>
  >;
  let owner: Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  let paymentReceiver: typeof owner;
  let royaltyReceiver: typeof owner;
  let user1: typeof owner;
  let user2: typeof owner;
  let publicClient: Awaited<ReturnType<typeof viem.getPublicClient>>;

  const MAX_SUPPLY = 10000n;
  const MAX_MINT_WALLET = 5n;
  const ROYALTY_FEE = 500n; // 5%
  const CONTRACT_URI = "ipfs://QmCollection";

  async function deployMembership(
    maxSupply = MAX_SUPPLY,
    maxMintPerWallet = MAX_MINT_WALLET,
  ) {
    return viem.deployContract("MembershipToken", [
      "ATTR-MEMBER-ID",
      "ATTR#",
      owner.account.address,
      paymentReceiver.account.address,
      royaltyReceiver.account.address,
      ROYALTY_FEE,
      CONTRACT_URI,
      maxSupply,
      maxMintPerWallet,
    ]);
  }

  beforeEach(async function () {
    [owner, paymentReceiver, royaltyReceiver, user1, user2] =
      await viem.getWalletClients();
    publicClient = await viem.getPublicClient();
    membership = await deployMembership();
  });

  // ── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await membership.read.name()).to.equal("ATTR-MEMBER-ID");
      expect(await membership.read.symbol()).to.equal("ATTR#");
    });

    it("Should set correct owner", async function () {
      expect(await membership.read.owner()).to.equal(
        getAddress(owner.account.address),
      );
    });

    it("Should set correct payment receiver", async function () {
      expect(await membership.read.paymentReceiver()).to.equal(
        getAddress(paymentReceiver.account.address),
      );
    });

    it("Should set correct max supply and max mint per wallet", async function () {
      expect(await membership.read.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
      expect(await membership.read.MAX_MINT_PER_WALLET()).to.equal(
        MAX_MINT_WALLET,
      );
    });

    it("Should set correct contractURI", async function () {
      expect(await membership.read.contractURI()).to.equal(CONTRACT_URI);
    });

    it("Should start with token ID 0", async function () {
      expect(await membership.read.getNextTokenId()).to.equal(0n);
      expect(await membership.read.totalSupply()).to.equal(0n);
    });

    it("Should revert on zero paymentReceiver", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("MembershipToken", [
          "X",
          "X",
          owner.account.address,
          zeroAddress,
          royaltyReceiver.account.address,
          ROYALTY_FEE,
          "",
          MAX_SUPPLY,
          MAX_MINT_WALLET,
        ]),
        membership,
        "ZeroAddress",
      );
    });

    it("Should revert on zero maxSupply", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("MembershipToken", [
          "X",
          "X",
          owner.account.address,
          paymentReceiver.account.address,
          royaltyReceiver.account.address,
          ROYALTY_FEE,
          "",
          0n,
          MAX_MINT_WALLET,
        ]),
        membership,
        "InvalidMaxSupply",
      );
    });

    it("Should revert on invalid maxMintPerWallet", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("MembershipToken", [
          "X",
          "X",
          owner.account.address,
          paymentReceiver.account.address,
          royaltyReceiver.account.address,
          ROYALTY_FEE,
          "",
          10n,
          0n,
        ]),
        membership,
        "InvalidMaxMintPerWallet",
      );

      await viem.assertions.revertWithCustomError(
        viem.deployContract("MembershipToken", [
          "X",
          "X",
          owner.account.address,
          paymentReceiver.account.address,
          royaltyReceiver.account.address,
          ROYALTY_FEE,
          "",
          5n,
          6n,
        ]),
        membership,
        "InvalidMaxMintPerWallet",
      );
    });
  });

  // ── contractURI ───────────────────────────────────────────────────────────

  describe("contractURI", function () {
    it("Should allow owner to update contractURI", async function () {
      const newURI = "ipfs://QmUpdated";
      await viem.assertions.emitWithArgs(
        membership.write.setContractURI([newURI]),
        membership,
        "ContractURIUpdated",
        [CONTRACT_URI, newURI],
      );
      expect(await membership.read.contractURI()).to.equal(newURI);
    });

    it("Should reject non-owner contractURI update", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.setContractURI(["ipfs://hack"], {
          account: user1.account,
        }),
        membership,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ── Tier Pricing ──────────────────────────────────────────────────────────

  describe("Tier Pricing", function () {
    it("Should allow owner to set tier prices", async function () {
      await viem.assertions.emitWithArgs(
        membership.write.setTierPrice([1n, parseEther("0.1")]),
        membership,
        "TierPriceUpdated",
        [1n, parseEther("0.1")],
      );
      expect(await membership.read.tierPrices([1n])).to.equal(
        parseEther("0.1"),
      );
    });

    it("Should not allow non-owner to set tier prices", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.setTierPrice([1n, parseEther("0.1")], {
          account: user1.account,
        }),
        membership,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should allow setting multiple tier prices", async function () {
      await membership.write.setTierPrice([1n, parseEther("0.05")]);
      await membership.write.setTierPrice([2n, parseEther("0.1")]);
      await membership.write.setTierPrice([3n, parseEther("0.2")]);
      expect(await membership.read.tierPrices([1n])).to.equal(
        parseEther("0.05"),
      );
      expect(await membership.read.tierPrices([2n])).to.equal(
        parseEther("0.1"),
      );
      expect(await membership.read.tierPrices([3n])).to.equal(
        parseEther("0.2"),
      );
    });
  });

  // ── Public Minting ────────────────────────────────────────────────────────

  describe("Public Minting", function () {
    beforeEach(async function () {
      await membership.write.setTierPrice([1n, parseEther("0.1")]);
      await membership.write.setTierPrice([2n, parseEther("0.2")]);
    });

    it("Should mint membership with correct payment", async function () {
      await viem.assertions.emitWithArgs(
        membership.write.mintMembership([1n, "ipfs://tier1"], {
          account: user1.account,
          value: parseEther("0.1"),
        }),
        membership,
        "MembershipMinted",
        [getAddress(user1.account.address), 0n, 1n, "ipfs://tier1"],
      );

      expect(await membership.read.ownerOf([0n])).to.equal(
        getAddress(user1.account.address),
      );
      expect(await membership.read.getTier([0n])).to.equal(1n);
    });

    it("Should reject insufficient payment", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.mintMembership([1n, "ipfs://tier1"], {
          account: user1.account,
          value: parseEther("0.05"),
        }),
        membership,
        "InsufficientPayment",
      );
    });

    it("Should allow overpayment (contract forwards all ETH)", async function () {
      await membership.write.mintMembership([1n, "ipfs://tier1"], {
        account: user1.account,
        value: parseEther("0.15"),
      });
      expect(await membership.read.ownerOf([0n])).to.equal(
        getAddress(user1.account.address),
      );
    });

    it("Should mint free tier (price = 0)", async function () {
      await membership.write.setTierPrice([0n, 0n]);
      await membership.write.mintMembership([0n, "ipfs://free"], {
        account: user1.account,
      });
      expect(await membership.read.ownerOf([0n])).to.equal(
        getAddress(user1.account.address),
      );
      expect(await membership.read.getTier([0n])).to.equal(0n);
    });

    it("Should increment token IDs correctly", async function () {
      await membership.write.mintMembership([1n, "ipfs://token0"], {
        account: user1.account,
        value: parseEther("0.1"),
      });

      await membership.write.mintMembership([1n, "ipfs://token1"], {
        account: user2.account,
        value: parseEther("0.1"),
      });

      expect(await membership.read.getNextTokenId()).to.equal(2n);
      expect(await membership.read.ownerOf([0n])).to.equal(
        getAddress(user1.account.address),
      );
      expect(await membership.read.ownerOf([1n])).to.equal(
        getAddress(user2.account.address),
      );
    });

    it("Should enforce MAX_MINT_PER_WALLET", async function () {
      const price = parseEther("0.1");
      for (let i = 0; i < Number(MAX_MINT_WALLET); i++) {
        await membership.write.mintMembership([1n, `ipfs://t${i}`], {
          account: user1.account,
          value: price,
        });
      }
      await viem.assertions.revertWithCustomError(
        membership.write.mintMembership([1n, "ipfs://over"], {
          account: user1.account,
          value: price,
        }),
        membership,
        "MaxMintPerWalletExceeded",
      );
    });

    it("Should track getMintedCount per wallet", async function () {
      expect(
        await membership.read.getMintedCount([user1.account.address]),
      ).to.equal(0n);
      await membership.write.mintMembership([1n, "ipfs://t"], {
        account: user1.account,
        value: parseEther("0.1"),
      });
      expect(
        await membership.read.getMintedCount([user1.account.address]),
      ).to.equal(1n);
    });

    it("Should enforce max supply", async function () {
      const small = await deployMembership(1n, 1n);
      await small.write.setTierPrice([1n, parseEther("0.1")]);
      await small.write.mintMembership([1n, "ipfs://1"], {
        account: user1.account,
        value: parseEther("0.1"),
      });
      await viem.assertions.revertWithCustomError(
        small.write.mintMembership([1n, "ipfs://2"], {
          account: user2.account,
          value: parseEther("0.1"),
        }),
        small,
        "MaxSupplyExceeded",
      );
    });

    it("Should forward payment to paymentReceiver immediately", async function () {
      const before = await publicClient.getBalance({
        address: paymentReceiver.account.address,
      });
      await membership.write.mintMembership([1n, "ipfs://t"], {
        account: user1.account,
        value: parseEther("0.1"),
      });
      expect(
        await publicClient.getBalance({ address: membership.address }),
      ).to.equal(0n);
      const after = await publicClient.getBalance({
        address: paymentReceiver.account.address,
      });
      expect(after - before).to.equal(parseEther("0.1"));
    });
  });

  // ── Admin Minting ─────────────────────────────────────────────────────────

  describe("Admin Minting", function () {
    it("Should allow owner to mint for free", async function () {
      await viem.assertions.emitWithArgs(
        membership.write.adminMintMembership([
          user1.account.address,
          1n,
          "ipfs://admin",
        ]),
        membership,
        "MembershipMinted",
        [getAddress(user1.account.address), 0n, 1n, "ipfs://admin"],
      );
      expect(await membership.read.ownerOf([0n])).to.equal(
        getAddress(user1.account.address),
      );
    });

    it("Admin mint should NOT count toward MAX_MINT_PER_WALLET", async function () {
      for (let i = 0; i < Number(MAX_MINT_WALLET) + 2; i++) {
        await membership.write.adminMintMembership([
          user1.account.address,
          1n,
          `ipfs://a${i}`,
        ]);
      }
      expect(
        await membership.read.getMintedCount([user1.account.address]),
      ).to.equal(0n);
    });

    it("Should not allow non-owner to admin mint", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.adminMintMembership(
          [user2.account.address, 1n, "ipfs://admin"],
          { account: user1.account },
        ),
        membership,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should revert admin mint to zero address", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.adminMintMembership([zeroAddress, 1n, "ipfs://a"]),
        membership,
        "ZeroAddress",
      );
    });

    it("Should enforce max supply for admin minting", async function () {
      const small = await deployMembership(1n, 1n);
      await small.write.adminMintMembership([
        user1.account.address,
        1n,
        "ipfs://1",
      ]);
      await viem.assertions.revertWithCustomError(
        small.write.adminMintMembership([
          user2.account.address,
          1n,
          "ipfs://2",
        ]),
        small,
        "MaxSupplyExceeded",
      );
    });
  });

  // ── Batch Admin Minting ───────────────────────────────────────────────────

  describe("Batch Admin Minting", function () {
    it("Should batch mint multiple memberships", async function () {
      const recipients = [
        user1.account.address,
        user2.account.address,
        owner.account.address,
      ] as const;
      const tiers = [1n, 2n, 3n] as const;
      const uris = ["ipfs://t1", "ipfs://t2", "ipfs://t3"] as const;

      await membership.write.adminBatchMintMemberships([
        [...recipients],
        [...tiers],
        [...uris],
      ]);

      expect(await membership.read.ownerOf([0n])).to.equal(
        getAddress(user1.account.address),
      );
      expect(await membership.read.ownerOf([1n])).to.equal(
        getAddress(user2.account.address),
      );
      expect(await membership.read.ownerOf([2n])).to.equal(
        getAddress(owner.account.address),
      );
      expect(await membership.read.getTier([0n])).to.equal(1n);
      expect(await membership.read.getTier([1n])).to.equal(2n);
      expect(await membership.read.getTier([2n])).to.equal(3n);
    });

    it("Should reject mismatched array lengths", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.adminBatchMintMemberships([
          [user1.account.address, user2.account.address],
          [1n],
          ["ipfs://t1", "ipfs://t2"],
        ]),
        membership,
        "ArrayLengthMismatch",
      );
    });

    it("Should not allow non-owner to batch mint", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.adminBatchMintMemberships(
          [[user2.account.address], [1n], ["ipfs://test"]],
          { account: user1.account },
        ),
        membership,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should reject batch minting beyond max supply", async function () {
      const small = await deployMembership(1n, 1n);
      await viem.assertions.revertWithCustomError(
        small.write.adminBatchMintMemberships([
          [user1.account.address, user2.account.address],
          [1n, 2n],
          ["ipfs://1", "ipfs://2"],
        ]),
        small,
        "MaxSupplyExceeded",
      );
    });
  });

  // ── Tier Management ───────────────────────────────────────────────────────

  describe("Tier Management", function () {
    beforeEach(async function () {
      await membership.write.adminMintMembership([
        user1.account.address,
        1n,
        "ipfs://tier1",
      ]);
    });

    it("Should allow owner to update tier", async function () {
      await viem.assertions.emitWithArgs(
        membership.write.updateTier([0n, 2n]),
        membership,
        "TierUpdated",
        [0n, 2n],
      );
      expect(await membership.read.getTier([0n])).to.equal(2n);
    });

    it("Should not allow non-owner to update tier", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.updateTier([0n, 2n], { account: user1.account }),
        membership,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should revert for non-existent token", async function () {
      await viem.assertions.revertWithCustomError(
        membership.read.getTier([999n]),
        membership,
        "ERC721NonexistentToken",
      );
    });
  });

  // ── Payment Receiver ──────────────────────────────────────────────────────

  describe("Payment Receiver", function () {
    it("Should allow updating payment receiver", async function () {
      await viem.assertions.emitWithArgs(
        membership.write.setPaymentReceiver([user2.account.address]),
        membership,
        "PaymentReceiverUpdated",
        [
          getAddress(paymentReceiver.account.address),
          getAddress(user2.account.address),
        ],
      );
      expect(await membership.read.paymentReceiver()).to.equal(
        getAddress(user2.account.address),
      );
    });

    it("Should not allow setting zero address as payment receiver", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.setPaymentReceiver([zeroAddress]),
        membership,
        "ZeroAddress",
      );
    });

    it("Should not allow non-owner to set payment receiver", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.setPaymentReceiver([user2.account.address], {
          account: user1.account,
        }),
        membership,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ── withdrawPayments ──────────────────────────────────────────────────────

  describe("withdrawPayments", function () {
    it("Should revert withdrawal when no funds held", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.withdrawPayments(),
        membership,
        "NothingToClaim",
      );
    });

    it("Should not allow non-owner to withdraw", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.withdrawPayments({ account: user1.account }),
        membership,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ── receive() ─────────────────────────────────────────────────────────────

  describe("receive()", function () {
    it("Should revert on direct ETH transfers", async function () {
      let reverted = false;
      try {
        await user1.sendTransaction({
          to: membership.address,
          value: 1n,
        });
      } catch {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });

  // ── Pause / Unpause ───────────────────────────────────────────────────────

  describe("Pause / Unpause", function () {
    it("Should allow owner to pause and unpause public minting", async function () {
      await viem.assertions.emitWithArgs(
        membership.write.pause(),
        membership,
        "Paused",
        [getAddress(owner.account.address)],
      );

      await viem.assertions.revertWithCustomError(
        membership.write.mintMembership([1n, "ipfs://paused"], {
          account: user1.account,
        }),
        membership,
        "EnforcedPause",
      );

      await viem.assertions.emitWithArgs(
        membership.write.unpause(),
        membership,
        "Unpaused",
        [getAddress(owner.account.address)],
      );
      await membership.write.mintMembership([1n, "ipfs://active"], {
        account: user1.account,
      });
      expect(await membership.read.ownerOf([0n])).to.equal(
        getAddress(user1.account.address),
      );
    });

    it("Should not allow non-owner to pause or unpause", async function () {
      await viem.assertions.revertWithCustomError(
        membership.write.pause({ account: user1.account }),
        membership,
        "OwnableUnauthorizedAccount",
      );

      await membership.write.pause();

      await viem.assertions.revertWithCustomError(
        membership.write.unpause({ account: user1.account }),
        membership,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ── Token URI ─────────────────────────────────────────────────────────────

  describe("Token URI", function () {
    it("Should return correct token URI", async function () {
      await membership.write.adminMintMembership([
        user1.account.address,
        1n,
        "ipfs://metadata",
      ]);
      expect(await membership.read.tokenURI([0n])).to.equal("ipfs://metadata");
    });

    it("Should allow owner to update token URI", async function () {
      await membership.write.adminMintMembership([
        user1.account.address,
        1n,
        "ipfs://old",
      ]);
      await membership.write.setTokenURI([0n, "ipfs://new"]);
      expect(await membership.read.tokenURI([0n])).to.equal("ipfs://new");
    });
  });

  // ── Royalties (ERC2981) ───────────────────────────────────────────────────

  describe("Royalties (ERC2981)", function () {
    it("Should return correct royalty info", async function () {
      await membership.write.adminMintMembership([
        user1.account.address,
        1n,
        "ipfs://t1",
      ]);
      const salePrice = parseEther("1");
      const [receiver, amount] = await membership.read.royaltyInfo([
        0n,
        salePrice,
      ]);
      expect(receiver).to.equal(getAddress(royaltyReceiver.account.address));
      expect(amount).to.equal((salePrice * ROYALTY_FEE) / 10000n);
    });

    it("Should support ERC2981 interface", async function () {
      expect(await membership.read.supportsInterface(["0x2a55205a"])).to.be
        .true;
    });
  });

  // ── Governance (ERC721Votes) ──────────────────────────────────────────────

  describe("Governance (ERC721Votes)", function () {
    beforeEach(async function () {
      await membership.write.adminMintMembership([
        user1.account.address,
        1n,
        "ipfs://t1",
      ]);
      await membership.write.adminMintMembership([
        user1.account.address,
        1n,
        "ipfs://t2",
      ]);
    });

    it("Should track votes after self-delegation", async function () {
      await membership.write.delegate([user1.account.address], {
        account: user1.account,
      });
      expect(await membership.read.getVotes([user1.account.address])).to.equal(
        2n,
      );
    });

    it("Should allow delegation to another address", async function () {
      await membership.write.delegate([user2.account.address], {
        account: user1.account,
      });
      expect(await membership.read.getVotes([user2.account.address])).to.equal(
        2n,
      );
      expect(await membership.read.getVotes([user1.account.address])).to.equal(
        0n,
      );
    });

    it("Should update votes on transfer", async function () {
      await membership.write.delegate([user1.account.address], {
        account: user1.account,
      });
      await membership.write.transferFrom(
        [user1.account.address, user2.account.address, 0n],
        { account: user1.account },
      );
      expect(await membership.read.getVotes([user1.account.address])).to.equal(
        1n,
      );
    });
  });

  // ── supportsInterface ─────────────────────────────────────────────────────

  describe("supportsInterface", function () {
    it("Should support ERC721 interface", async function () {
      expect(await membership.read.supportsInterface(["0x80ac58cd"])).to.be
        .true;
    });
  });

  // ── totalSupply ───────────────────────────────────────────────────────────

  describe("totalSupply", function () {
    it("Should track total supply correctly", async function () {
      expect(await membership.read.totalSupply()).to.equal(0n);
      await membership.write.adminMintMembership([
        user1.account.address,
        1n,
        "ipfs://t1",
      ]);
      expect(await membership.read.totalSupply()).to.equal(1n);
      await membership.write.adminMintMembership([
        user2.account.address,
        1n,
        "ipfs://t2",
      ]);
      expect(await membership.read.totalSupply()).to.equal(2n);
    });
  });
});
