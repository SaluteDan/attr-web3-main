import { expect } from "chai";
import { ethers } from "hardhat";
import {
  ATTRDeployer,
  NFTCollection,
  PaymentSplitter,
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ATTRDeployer", function () {
  let factory: ATTRDeployer;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  let treasury: SignerWithAddress;

  beforeEach(async function () {
    [owner, addr1, addr2, treasury] = await ethers.getSigners();

    const FactoryContract = await ethers.getContractFactory("ATTRDeployer");
    const deployedFactory = await FactoryContract.deploy(
      owner.address,
      ethers.ZeroAddress,
    );
    await deployedFactory.waitForDeployment();
    factory = deployedFactory as unknown as ATTRDeployer;
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("Should store attrSpender address", async function () {
      expect(await factory.attrSpender()).to.equal(ethers.ZeroAddress);
    });
  });

  // ── Collection Creation ────────────────────────────────────────────────────

  describe("Collection Creation", function () {
    it("Should deploy a new NFT collection and emit CollectionDeployed", async function () {
      await expect(
        factory.createCollection(
          "Test Collection",
          "TEST",
          500,
          [owner.address],
          [100],
          "ipfs://test",
          10000,
          10,
        ),
      ).to.emit(factory, "CollectionDeployed");
    });

    it("Should also emit legacy CollectionCreated event", async function () {
      await expect(
        factory.createCollection(
          "Test",
          "TST",
          500,
          [owner.address],
          [100],
          "ipfs://test",
          10000,
          10,
        ),
      ).to.emit(factory, "CollectionCreated");
    });

    it("Should track deployed collections", async function () {
      await factory.createCollection(
        "Collection 1",
        "C1",
        500,
        [owner.address],
        [100],
        "ipfs://test",
        10000,
        10,
      );
      await factory.createCollection(
        "Collection 2",
        "C2",
        500,
        [owner.address],
        [100],
        "ipfs://test",
        10000,
        10,
      );

      const collections = await factory.getDeployedCollections();
      expect(collections.length).to.equal(2);
      expect(await factory.getCollectionCount()).to.equal(2);
      expect(await factory.getCollectionAt(0)).to.equal(collections[0]);
    });

    it("Should revert when collection index is out of bounds", async function () {
      await expect(factory.getCollectionAt(0)).to.be.revertedWithCustomError(
        factory,
        "IndexOutOfBounds",
      );
    });

    it("Should allow only owner to create collections", async function () {
      await expect(
        factory
          .connect(addr1)
          .createCollection(
            "Test",
            "TST",
            500,
            [owner.address],
            [100],
            "ipfs://test",
            10000,
            10,
          ),
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("Should validate required collection parameters", async function () {
      await expect(
        factory.createCollection(
          "",
          "TST",
          500,
          [owner.address],
          [100],
          "ipfs://test",
          10000,
          10,
        ),
      ).to.be.revertedWithCustomError(factory, "EmptyName");

      await expect(
        factory.createCollection(
          "Test",
          "",
          500,
          [owner.address],
          [100],
          "ipfs://test",
          10000,
          10,
        ),
      ).to.be.revertedWithCustomError(factory, "EmptySymbol");

      await expect(
        factory.createCollection(
          "Test",
          "TST",
          10001,
          [owner.address],
          [100],
          "ipfs://test",
          10000,
          10,
        ),
      ).to.be.revertedWithCustomError(factory, "RoyaltyFeeTooHigh");

      await expect(
        factory.createCollection(
          "Test",
          "TST",
          500,
          [owner.address],
          [100],
          "ipfs://test",
          0,
          10,
        ),
      ).to.be.revertedWithCustomError(factory, "InvalidMaxSupply");

      await expect(
        factory.createCollection(
          "Test",
          "TST",
          500,
          [owner.address],
          [100],
          "ipfs://test",
          10000,
          0,
        ),
      ).to.be.revertedWithCustomError(factory, "InvalidMaxMintPerWallet");

      await expect(
        factory.createCollection(
          "Test",
          "TST",
          500,
          [owner.address],
          [100],
          "ipfs://test",
          5,
          6,
        ),
      ).to.be.revertedWithCustomError(factory, "InvalidMaxMintPerWallet");
    });

    it("Should deploy collection with correct name and symbol", async function () {
      await factory.createCollection(
        "My NFT",
        "MNFT",
        500,
        [owner.address],
        [100],
        "ipfs://test",
        10000,
        10,
      );

      const collections = await factory.getDeployedCollections();
      const collectionAddress = collections[collections.length - 1];
      const NFTContract = await ethers.getContractFactory("NFTCollection");
      const collection = NFTContract.attach(
        collectionAddress,
      ) as unknown as NFTCollection;

      expect(await collection.name()).to.equal("My NFT");
      expect(await collection.symbol()).to.equal("MNFT");
    });
  });

  // ── PaymentSplitter Integration ────────────────────────────────────────────

  describe("PaymentSplitter Integration", function () {
    it("Should deploy PaymentSplitter when multiple creators are provided", async function () {
      await factory.createCollection(
        "Test Collection",
        "TEST",
        500,
        [addr1.address, treasury.address],
        [500, 2000],
        "ipfs://test",
        10000,
        10,
      );

      const collections = await factory.getDeployedCollections();
      const collectionAddress = collections[collections.length - 1];
      const splitterAddress =
        await factory.getPaymentSplitter(collectionAddress);
      expect(splitterAddress).to.not.equal(ethers.ZeroAddress);

      const SplitterContract =
        await ethers.getContractFactory("PaymentSplitter");
      const splitter = SplitterContract.attach(
        splitterAddress,
      ) as unknown as PaymentSplitter;

      expect(await splitter.shares(addr1.address)).to.equal(500);
      expect(await splitter.shares(treasury.address)).to.equal(2000);
      expect(await splitter.totalShares()).to.equal(2500);
    });

    it("Should not deploy PaymentSplitter when only one creator", async function () {
      await factory.createCollection(
        "Test",
        "TEST",
        500,
        [addr1.address],
        [100],
        "ipfs://test",
        10000,
        10,
      );

      const collections = await factory.getDeployedCollections();
      const collectionAddress = collections[collections.length - 1];
      const splitterAddress =
        await factory.getPaymentSplitter(collectionAddress);
      expect(splitterAddress).to.equal(ethers.ZeroAddress);
    });

    it("Should track all deployed PaymentSplitters", async function () {
      await factory.createCollection(
        "C1",
        "C1",
        500,
        [addr1.address, treasury.address],
        [500, 1000],
        "ipfs://test",
        10000,
        10,
      );
      await factory.createCollection(
        "C2",
        "C2",
        500,
        [addr1.address, treasury.address],
        [500, 1500],
        "ipfs://test",
        10000,
        10,
      );
      await factory.createCollection(
        "C3",
        "C3",
        500,
        [addr1.address],
        [100],
        "ipfs://test",
        10000,
        10,
      );

      const splitters = await factory.getDeployedSplitters();
      expect(splitters.length).to.be.at.least(2);
      expect(await factory.getSplitterCount()).to.be.at.least(2);
    });

    it("Should allow retrieving PaymentSplitter by index", async function () {
      await factory.createCollection(
        "Test",
        "TEST",
        500,
        [addr1.address, treasury.address],
        [500, 2000],
        "ipfs://test",
        10000,
        10,
      );

      const splitterAddress = await factory.getSplitterAt(0);
      expect(splitterAddress).to.not.equal(ethers.ZeroAddress);

      const collections = await factory.getDeployedCollections();
      const collectionAddress = collections[collections.length - 1];
      const linkedSplitter =
        await factory.getPaymentSplitter(collectionAddress);
      expect(splitterAddress).to.equal(linkedSplitter);
    });

    it("Should revert when splitter index is out of bounds", async function () {
      await expect(factory.getSplitterAt(0)).to.be.revertedWithCustomError(
        factory,
        "IndexOutOfBounds",
      );
    });

    it("Should support 3+ creators", async function () {
      const [, a, b, c] = await ethers.getSigners();
      await factory.createCollection(
        "Multi Creator",
        "MULTI",
        500,
        [a.address, b.address, c.address],
        [50, 30, 20],
        "ipfs://test",
        10000,
        10,
      );

      const splitterAddress = await factory.getSplitterAt(0);
      const SplitterContract =
        await ethers.getContractFactory("PaymentSplitter");
      const splitter = SplitterContract.attach(
        splitterAddress,
      ) as unknown as PaymentSplitter;

      expect(await splitter.shares(a.address)).to.equal(50);
      expect(await splitter.shares(b.address)).to.equal(30);
      expect(await splitter.shares(c.address)).to.equal(20);
      expect(await splitter.totalShares()).to.equal(100);
    });

    it("Should revert when creators and shares arrays mismatch", async function () {
      await expect(
        factory.createCollection(
          "Bad",
          "BAD",
          500,
          [addr1.address, treasury.address],
          [100],
          "ipfs://test",
          10000,
          10,
        ),
      ).to.be.revertedWithCustomError(factory, "ArrayLengthMismatch");
    });

    it("Should revert when no creators provided", async function () {
      await expect(
        factory.createCollection(
          "Bad",
          "BAD",
          500,
          [],
          [],
          "ipfs://test",
          10000,
          10,
        ),
      ).to.be.revertedWithCustomError(factory, "ArrayLengthMismatch");
    });

    it("Should reject zero royalty creator address and zero royalty share", async function () {
      await expect(
        factory.createCollection(
          "Bad",
          "BAD",
          500,
          [ethers.ZeroAddress],
          [100],
          "ipfs://test",
          10000,
          10,
        ),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");

      await expect(
        factory.createCollection(
          "Bad",
          "BAD",
          500,
          [addr1.address],
          [0],
          "ipfs://test",
          10000,
          10,
        ),
      ).to.be.revertedWithCustomError(factory, "InvalidShare");
    });

    // ── Separate Mint/Royalty Receivers ──────────────────────────────────────

    describe("Separate Mint/Royalty Receivers", function () {
      it("Should deploy with different mint and royalty creators (separate model)", async function () {
        await factory.createCollectionWithSeparateReceivers(
          "Separate Collection",
          "SEP",
          500,
          [addr1.address, treasury.address],
          [300, 200],
          [treasury.address],
          [10000],
          "ipfs://test",
          10000,
          10,
          addr1.address, // tipReceiver
        );

        const collections = await factory.getDeployedCollections();
        const collectionAddress = collections[collections.length - 1];
        expect(collectionAddress).to.not.equal(ethers.ZeroAddress);
        expect(await factory.getSplitterCount()).to.equal(1);
      });

      it("Should support single creator for royalties, gallery for mint (gallery-first model)", async function () {
        await factory.createCollectionWithSeparateReceivers(
          "Gallery First",
          "GFIRST",
          500,
          [addr1.address, treasury.address],
          [300, 200],
          [treasury.address],
          [10000],
          "ipfs://test",
          10000,
          10,
          addr1.address, // tipReceiver
        );

        const collections = await factory.getDeployedCollections();
        expect(collections.length).to.equal(1);
      });

      it("Should support same creators for both (unified model — reuses one splitter)", async function () {
        await factory.createCollectionWithSeparateReceivers(
          "Unified Collection",
          "UNI",
          500,
          [addr1.address, treasury.address],
          [300, 200],
          [addr1.address, treasury.address],
          [300, 200],
          "ipfs://test",
          10000,
          10,
          addr1.address, // tipReceiver
        );

        const collections = await factory.getDeployedCollections();
        expect(collections.length).to.equal(1);
        expect(await factory.getSplitterCount()).to.equal(1);
      });

      it("Should revert on zero tipReceiver", async function () {
        await expect(
          factory.createCollectionWithSeparateReceivers(
            "Bad",
            "BAD",
            500,
            [addr1.address],
            [100],
            [addr1.address],
            [100],
            "ipfs://test",
            10000,
            10,
            ethers.ZeroAddress, // tipReceiver = zero → ZeroAddress revert
          ),
        ).to.be.revertedWithCustomError(factory, "ZeroAddress");
      });

      it("Should revert when mint creators and shares arrays mismatch", async function () {
        await expect(
          factory.createCollectionWithSeparateReceivers(
            "Bad",
            "BAD",
            500,
            [addr1.address],
            [100],
            [treasury.address, addr1.address],
            [100],
            "ipfs://test",
            10000,
            10,
            addr1.address,
          ),
        ).to.be.revertedWithCustomError(factory, "ArrayLengthMismatch");
      });

      it("Should revert when royalty creators and shares arrays mismatch", async function () {
        await expect(
          factory.createCollectionWithSeparateReceivers(
            "Bad",
            "BAD",
            500,
            [addr1.address, treasury.address],
            [100],
            [treasury.address],
            [100],
            "ipfs://test",
            10000,
            10,
            addr1.address,
          ),
        ).to.be.revertedWithCustomError(factory, "ArrayLengthMismatch");
      });

      it("Should reject empty mint creators, zero mint address, and zero mint share", async function () {
        await expect(
          factory.createCollectionWithSeparateReceivers(
            "Bad",
            "BAD",
            500,
            [addr1.address],
            [100],
            [],
            [],
            "ipfs://test",
            10000,
            10,
            addr1.address,
          ),
        ).to.be.revertedWithCustomError(factory, "ArrayLengthMismatch");

        await expect(
          factory.createCollectionWithSeparateReceivers(
            "Bad",
            "BAD",
            500,
            [addr1.address],
            [100],
            [ethers.ZeroAddress],
            [100],
            "ipfs://test",
            10000,
            10,
            addr1.address,
          ),
        ).to.be.revertedWithCustomError(factory, "ZeroAddress");

        await expect(
          factory.createCollectionWithSeparateReceivers(
            "Bad",
            "BAD",
            500,
            [addr1.address],
            [100],
            [treasury.address],
            [0],
            "ipfs://test",
            10000,
            10,
            addr1.address,
          ),
        ).to.be.revertedWithCustomError(factory, "InvalidShare");
      });

      it("Should emit both CollectionDeployed and CollectionCreated events", async function () {
        const tx = factory.createCollectionWithSeparateReceivers(
          "Test Sep",
          "TESTSEP",
          500,
          [addr1.address, treasury.address],
          [300, 200],
          [treasury.address],
          [10000],
          "ipfs://test",
          10000,
          10,
          addr1.address,
        );
        await expect(tx).to.emit(factory, "CollectionDeployed");
        await expect(tx).to.emit(factory, "CollectionCreated");
      });
    });
  });
});
