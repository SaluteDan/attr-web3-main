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

    // Deploy Factory
    const FactoryContract = await ethers.getContractFactory("ATTRDeployer");
    const deployedFactory = await FactoryContract.deploy(owner.address);
    await deployedFactory.waitForDeployment();
    factory = deployedFactory as unknown as ATTRDeployer;
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });
  });

  describe("Collection Creation", function () {
    it("Should deploy a new NFT collection", async function () {
      const name = "Test Collection";
      const symbol = "TEST";

      const tx = await factory.createCollection(
        name,
        symbol,
        500, // Royalty
        [owner.address], // Single creator
        [100], // Share weight
        "ipfs://test",
        10000,
        10,
      );
      const receipt = await tx.wait();

      // Check event emission
      const event = receipt?.logs.find((log: any) => {
        try {
          return factory.interface.parseLog(log)?.name === "CollectionCreated";
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
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
      await expect(factory.getCollectionAt(0)).to.be.revertedWith(
        "Index out of bounds",
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
        factory.createCollection("", "TST", 500, [owner.address], [100], "ipfs://test", 10000, 10),
      ).to.be.revertedWith("Name cannot be empty");

      await expect(
        factory.createCollection("Test", "", 500, [owner.address], [100], "ipfs://test", 10000, 10),
      ).to.be.revertedWith("Symbol cannot be empty");

      await expect(
        factory.createCollection("Test", "TST", 10001, [owner.address], [100], "ipfs://test", 10000, 10),
      ).to.be.revertedWith("Royalty fee too high");

      await expect(
        factory.createCollection("Test", "TST", 500, [owner.address], [100], "ipfs://test", 0, 10),
      ).to.be.revertedWith("Max supply must be greater than 0");

      await expect(
        factory.createCollection("Test", "TST", 500, [owner.address], [100], "ipfs://test", 10000, 0),
      ).to.be.revertedWith("Max mint per wallet must be greater than 0");

      await expect(
        factory.createCollection("Test", "TST", 500, [owner.address], [100], "ipfs://test", 5, 6),
      ).to.be.revertedWith("Max mint per wallet exceeds max supply");
    });

    it("Should deploy collection with correct name and symbol", async function () {
      const name = "My NFT";
      const symbol = "MNFT";

      const tx = await factory.createCollection(
        name,
        symbol,
        500,
        [owner.address],
        [100],
        "ipfs://test",
        10000,
        10,
      );
      const receipt = await tx.wait();

      const collections = await factory.getDeployedCollections();
      const collectionAddress = collections[collections.length - 1];

      const NFTContract = await ethers.getContractFactory("NFTCollection");
      const collection = NFTContract.attach(
        collectionAddress,
      ) as unknown as NFTCollection;

      expect(await collection.name()).to.equal(name);
      expect(await collection.symbol()).to.equal(symbol);
    });
  });

  describe("PaymentSplitter Integration", function () {
    it("Should deploy PaymentSplitter when multiple creators are provided", async function () {
      const tx = await factory.createCollection(
        "Test Collection",
        "TEST",
        500, // 5% royalty
        [addr1.address, treasury.address], // Two creators
        [500, 2000], // Artist: 500, Platform: 2000
        "ipfs://test",
        10000,
        10,
      );
      const receipt = await tx.wait();

      // Check event includes PaymentSplitter address
      const event = receipt?.logs.find((log: any) => {
        try {
          const parsed = factory.interface.parseLog(log);
          return parsed?.name === "CollectionCreated";
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;

      const collections = await factory.getDeployedCollections();
      const collectionAddress = collections[collections.length - 1];

      // Check that PaymentSplitter was created and stored
      const splitterAddress = await factory.getPaymentSplitter(
        collectionAddress,
      );
      expect(splitterAddress).to.not.equal(ethers.ZeroAddress);

      // Verify PaymentSplitter configuration
      const SplitterContract = await ethers.getContractFactory(
        "PaymentSplitter",
      );
      const splitter = SplitterContract.attach(
        splitterAddress,
      ) as unknown as PaymentSplitter;

      expect(await splitter.shares(addr1.address)).to.equal(500); // Artist share
      expect(await splitter.shares(treasury.address)).to.equal(2000); // Platform share
      expect(await splitter.totalShares()).to.equal(2500); // Total weight
    });

    it("Should not deploy PaymentSplitter when only one creator", async function () {
      await factory.createCollection(
        "Test Collection",
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

      const splitterAddress = await factory.getPaymentSplitter(
        collectionAddress,
      );
      expect(splitterAddress).to.equal(ethers.ZeroAddress);
    });

    it("Should track all deployed PaymentSplitters", async function () {
      // Deploy multiple collections with PaymentSplitters
      await factory.createCollection(
        "Collection 1",
        "C1",
        500,
        [addr1.address, treasury.address],
        [500, 1000],
        "ipfs://test",
        10000,
        10,
      );
      await factory.createCollection(
        "Collection 2",
        "C2",
        500,
        [addr1.address, treasury.address],
        [500, 1500],
        "ipfs://test",
        10000,
        10,
      );
      await factory.createCollection(
        "Collection 3",
        "C3",
        500,
        [addr1.address], // Single creator, no splitter
        [100],
        "ipfs://test",
        10000,
        10,
      );

      const splitters = await factory.getDeployedSplitters();
      // Each multi-creator deployment adds 1 splitter
      // Collection 1 (2 creators) and Collection 2 (2 creators) each add 1 splitter
      // Collection 3 (1 creator) adds no splitter
      // We check that at least 2 splitters exist from this test's collections
      expect(splitters.length).to.be.at.least(2);
      expect(await factory.getSplitterCount()).to.be.at.least(2);
    });

    it("Should allow retrieving PaymentSplitter by index", async function () {
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

      const splitterAddress = await factory.getSplitterAt(0);
      expect(splitterAddress).to.not.equal(ethers.ZeroAddress);

      // Verify it's the same as the one linked to the collection
      const collections = await factory.getDeployedCollections();
      const collectionAddress = collections[collections.length - 1];
      const linkedSplitter = await factory.getPaymentSplitter(
        collectionAddress,
      );

      expect(splitterAddress).to.equal(linkedSplitter);
    });

    it("Should revert when splitter index is out of bounds", async function () {
      await expect(factory.getSplitterAt(0)).to.be.revertedWith(
        "Index out of bounds",
      );
    });

    it("Should emit CollectionCreated event with PaymentSplitter address", async function () {
      await expect(
        factory.createCollection(
          "Test Collection",
          "TEST",
          500,
          [addr1.address, treasury.address],
          [500, 2000],
          "ipfs://test",
          10000,
          10,
        ),
      ).to.emit(factory, "CollectionCreated");
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
      const SplitterContract = await ethers.getContractFactory(
        "PaymentSplitter",
      );
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
      ).to.be.revertedWith("Royalty creators and shares length mismatch");
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
      ).to.be.revertedWith("Must have at least one royalty creator");
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
      ).to.be.revertedWith("Royalty creator address cannot be zero");

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
      ).to.be.revertedWith("Royalty creator share must be greater than 0");
    });

    // Tests for createCollectionWithSeparateReceivers
    describe("Separate Mint/Royalty Receivers", function () {
      it("Should deploy with different mint and royalty creators (separate model)", async function () {
        await factory.createCollectionWithSeparateReceivers(
          "Separate Collection",
          "SEP",
          500,
          // Royalty creators (for secondary sales)
          [addr1.address, treasury.address],
          [300, 200],
          // Mint creators (for initial mint payments)
          [treasury.address], // Gallery keeps 100% of mint
          [10000],
          "ipfs://test",
          10000,
          10,
        );

        const collections = await factory.getDeployedCollections();
        const collectionAddress = collections[collections.length - 1];

        // Verify collection was deployed
        expect(collectionAddress).to.not.equal(ethers.ZeroAddress);

        // Should have deployed 1 splitter (for royalties) + 0 for mint (single creator, direct payment)
        expect(await factory.getSplitterCount()).to.equal(1);
      });

      it("Should support single creator for royalties, gallery for mint (gallery-first model)", async function () {
        await factory.createCollectionWithSeparateReceivers(
          "Gallery First",
          "GFIRST",
          500,
          // Royalty: Artist + platform
          [addr1.address, treasury.address],
          [300, 200],
          // Mint: Only platform (gallery keeps all)
          [treasury.address],
          [10000],
          "ipfs://test",
          10000,
          10,
        );

        const collections = await factory.getDeployedCollections();
        expect(collections.length).to.equal(1);
      });

      it("Should support same creators for both (unified model)", async function () {
        await factory.createCollectionWithSeparateReceivers(
          "Unified Collection",
          "UNI",
          500,
          [addr1.address, treasury.address],
          [300, 200],
          // Same creators for mint
          [addr1.address, treasury.address],
          [300, 200],
          "ipfs://test",
          10000,
          10,
        );

        const collections = await factory.getDeployedCollections();
        expect(collections.length).to.equal(1);

        // When mint and royalty distributions are identical, the factory reuses
        // a single splitter for both instead of deploying a duplicate.
        expect(await factory.getSplitterCount()).to.equal(1);
      });

      it("Should revert when mint creators and shares arrays mismatch", async function () {
        await expect(
          factory.createCollectionWithSeparateReceivers(
            "Bad",
            "BAD",
            500,
            [addr1.address],
            [100],
            [treasury.address, addr1.address], // 2 creators
            [100], // Only 1 share
            "ipfs://test",
            10000,
            10,
          ),
        ).to.be.revertedWith("Mint creators and shares length mismatch");
      });

      it("Should revert when royalty creators and shares arrays mismatch", async function () {
        await expect(
          factory.createCollectionWithSeparateReceivers(
            "Bad",
            "BAD",
            500,
            [addr1.address, treasury.address], // 2 creators
            [100], // Only 1 share
            [treasury.address],
            [100],
            "ipfs://test",
            10000,
            10,
          ),
        ).to.be.revertedWith("Royalty creators and shares length mismatch");
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
          ),
        ).to.be.revertedWith("Must have at least one mint creator");

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
          ),
        ).to.be.revertedWith("Mint creator address cannot be zero");

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
          ),
        ).to.be.revertedWith("Mint creator share must be greater than 0");
      });

      it("Should emit CollectionCreated event with royalty splitter (separate receivers)", async function () {
        await expect(
          factory.createCollectionWithSeparateReceivers(
            "Test Separate",
            "TESTSEP",
            500,
            [addr1.address, treasury.address],
            [300, 200],
            [treasury.address],
            [10000],
            "ipfs://test",
            10000,
            10,
          ),
        ).to.emit(factory, "CollectionCreated");
      });
    });
  });
});
