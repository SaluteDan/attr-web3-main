import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { zeroAddress, getAddress } from "viem";

const { viem, networkHelpers } = await hre.network.create();

describe("ATTRDeployer", function () {
  let factory: Awaited<ReturnType<typeof viem.deployContract<"ATTRDeployer">>>;
  let owner: Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  let addr1: typeof owner;
  let addr2: typeof owner;
  let treasury: typeof owner;

  beforeEach(async function () {
    [owner, addr1, addr2, treasury] = await viem.getWalletClients();

    factory = await viem.deployContract("ATTRDeployer", [
      owner.account.address,
      zeroAddress,
    ]);
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await factory.read.owner()).to.equal(
        getAddress(owner.account.address),
      );
    });

    it("Should store attrSpender address", async function () {
      expect(await factory.read.attrSpender()).to.equal(zeroAddress);
    });
  });

  // ── Collection Creation ────────────────────────────────────────────────────

  describe("Collection Creation", function () {
    it("Should deploy a new NFT collection and emit CollectionDeployed", async function () {
      await viem.assertions.emit(
        factory.write.createCollection([
          "Test Collection",
          "TEST",
          500,
          [owner.account.address],
          [100n],
          "ipfs://test",
          10000n,
          10n,
        ]),
        factory,
        "CollectionDeployed",
      );
    });

    it("Should also emit legacy CollectionCreated event", async function () {
      await viem.assertions.emit(
        factory.write.createCollection([
          "Test",
          "TST",
          500,
          [owner.account.address],
          [100n],
          "ipfs://test",
          10000n,
          10n,
        ]),
        factory,
        "CollectionCreated",
      );
    });

    it("Should track deployed collections", async function () {
      await factory.write.createCollection([
        "Collection 1",
        "C1",
        500,
        [owner.account.address],
        [100n],
        "ipfs://test",
        10000n,
        10n,
      ]);
      await factory.write.createCollection([
        "Collection 2",
        "C2",
        500,
        [owner.account.address],
        [100n],
        "ipfs://test",
        10000n,
        10n,
      ]);

      const collections = await factory.read.getDeployedCollections();
      expect(collections.length).to.equal(2);
      expect(await factory.read.getCollectionCount()).to.equal(2n);
      expect(await factory.read.getCollectionAt([0n])).to.equal(collections[0]);
    });

    it("Should revert when collection index is out of bounds", async function () {
      await viem.assertions.revertWithCustomError(
        factory.read.getCollectionAt([0n]),
        factory,
        "IndexOutOfBounds",
      );
    });

    it("Should allow only owner to create collections", async function () {
      await viem.assertions.revertWithCustomError(
        factory.write.createCollection(
          [
            "Test",
            "TST",
            500,
            [owner.account.address],
            [100n],
            "ipfs://test",
            10000n,
            10n,
          ],
          { account: addr1.account },
        ),
        factory,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should validate required collection parameters", async function () {
      await viem.assertions.revertWithCustomError(
        factory.write.createCollection([
          "",
          "TST",
          500,
          [owner.account.address],
          [100n],
          "ipfs://test",
          10000n,
          10n,
        ]),
        factory,
        "EmptyName",
      );

      await viem.assertions.revertWithCustomError(
        factory.write.createCollection([
          "Test",
          "",
          500,
          [owner.account.address],
          [100n],
          "ipfs://test",
          10000n,
          10n,
        ]),
        factory,
        "EmptySymbol",
      );

      await viem.assertions.revertWithCustomError(
        factory.write.createCollection([
          "Test",
          "TST",
          10001,
          [owner.account.address],
          [100n],
          "ipfs://test",
          10000n,
          10n,
        ]),
        factory,
        "RoyaltyFeeTooHigh",
      );

      await viem.assertions.revertWithCustomError(
        factory.write.createCollection([
          "Test",
          "TST",
          500,
          [owner.account.address],
          [100n],
          "ipfs://test",
          0n,
          10n,
        ]),
        factory,
        "InvalidMaxSupply",
      );

      await viem.assertions.revertWithCustomError(
        factory.write.createCollection([
          "Test",
          "TST",
          500,
          [owner.account.address],
          [100n],
          "ipfs://test",
          10000n,
          0n,
        ]),
        factory,
        "InvalidMaxMintPerWallet",
      );

      await viem.assertions.revertWithCustomError(
        factory.write.createCollection([
          "Test",
          "TST",
          500,
          [owner.account.address],
          [100n],
          "ipfs://test",
          5n,
          6n,
        ]),
        factory,
        "InvalidMaxMintPerWallet",
      );
    });

    it("Should deploy collection with correct name and symbol", async function () {
      await factory.write.createCollection([
        "My NFT",
        "MNFT",
        500,
        [owner.account.address],
        [100n],
        "ipfs://test",
        10000n,
        10n,
      ]);

      const collections = await factory.read.getDeployedCollections();
      const collectionAddress = collections[collections.length - 1];
      const collection = await viem.getContractAt(
        "NFTCollection",
        collectionAddress,
      );

      expect(await collection.read.name()).to.equal("My NFT");
      expect(await collection.read.symbol()).to.equal("MNFT");
    });
  });

  // ── PaymentSplitter Integration ────────────────────────────────────────────

  describe("PaymentSplitter Integration", function () {
    it("Should deploy PaymentSplitter when multiple creators are provided", async function () {
      await factory.write.createCollection([
        "Test Collection",
        "TEST",
        500,
        [addr1.account.address, treasury.account.address],
        [500n, 2000n],
        "ipfs://test",
        10000n,
        10n,
      ]);

      const collections = await factory.read.getDeployedCollections();
      const collectionAddress = collections[collections.length - 1];
      const splitterAddress = await factory.read.getPaymentSplitter([
        collectionAddress,
      ]);
      expect(splitterAddress).to.not.equal(zeroAddress);

      const splitter = await viem.getContractAt(
        "PaymentSplitter",
        splitterAddress,
      );

      expect(await splitter.read.shares([addr1.account.address])).to.equal(
        500n,
      );
      expect(await splitter.read.shares([treasury.account.address])).to.equal(
        2000n,
      );
      expect(await splitter.read.totalShares()).to.equal(2500n);
    });

    it("Should not deploy PaymentSplitter when only one creator", async function () {
      await factory.write.createCollection([
        "Test",
        "TEST",
        500,
        [addr1.account.address],
        [100n],
        "ipfs://test",
        10000n,
        10n,
      ]);

      const collections = await factory.read.getDeployedCollections();
      const collectionAddress = collections[collections.length - 1];
      const splitterAddress = await factory.read.getPaymentSplitter([
        collectionAddress,
      ]);
      expect(splitterAddress).to.equal(zeroAddress);
    });

    it("Should track all deployed PaymentSplitters", async function () {
      await factory.write.createCollection([
        "C1",
        "C1",
        500,
        [addr1.account.address, treasury.account.address],
        [500n, 1000n],
        "ipfs://test",
        10000n,
        10n,
      ]);
      await factory.write.createCollection([
        "C2",
        "C2",
        500,
        [addr1.account.address, treasury.account.address],
        [500n, 1500n],
        "ipfs://test",
        10000n,
        10n,
      ]);
      await factory.write.createCollection([
        "C3",
        "C3",
        500,
        [addr1.account.address],
        [100n],
        "ipfs://test",
        10000n,
        10n,
      ]);

      const splitters = await factory.read.getDeployedSplitters();
      expect(splitters.length).to.be.at.least(2);
      expect(Number(await factory.read.getSplitterCount())).to.be.at.least(2);
    });

    it("Should allow retrieving PaymentSplitter by index", async function () {
      await factory.write.createCollection([
        "Test",
        "TEST",
        500,
        [addr1.account.address, treasury.account.address],
        [500n, 2000n],
        "ipfs://test",
        10000n,
        10n,
      ]);

      const splitterAddress = await factory.read.getSplitterAt([0n]);
      expect(splitterAddress).to.not.equal(zeroAddress);

      const collections = await factory.read.getDeployedCollections();
      const collectionAddress = collections[collections.length - 1];
      const linkedSplitter = await factory.read.getPaymentSplitter([
        collectionAddress,
      ]);
      expect(splitterAddress).to.equal(linkedSplitter);
    });

    it("Should revert when splitter index is out of bounds", async function () {
      await viem.assertions.revertWithCustomError(
        factory.read.getSplitterAt([0n]),
        factory,
        "IndexOutOfBounds",
      );
    });

    it("Should support 3+ creators", async function () {
      const [, a, b, c] = await viem.getWalletClients();
      await factory.write.createCollection([
        "Multi Creator",
        "MULTI",
        500,
        [a.account.address, b.account.address, c.account.address],
        [50n, 30n, 20n],
        "ipfs://test",
        10000n,
        10n,
      ]);

      const splitterAddress = await factory.read.getSplitterAt([0n]);
      const splitter = await viem.getContractAt(
        "PaymentSplitter",
        splitterAddress,
      );

      expect(await splitter.read.shares([a.account.address])).to.equal(50n);
      expect(await splitter.read.shares([b.account.address])).to.equal(30n);
      expect(await splitter.read.shares([c.account.address])).to.equal(20n);
      expect(await splitter.read.totalShares()).to.equal(100n);
    });

    it("Should revert when creators and shares arrays mismatch", async function () {
      await viem.assertions.revertWithCustomError(
        factory.write.createCollection([
          "Bad",
          "BAD",
          500,
          [addr1.account.address, treasury.account.address],
          [100n],
          "ipfs://test",
          10000n,
          10n,
        ]),
        factory,
        "ArrayLengthMismatch",
      );
    });

    it("Should revert when no creators provided", async function () {
      await viem.assertions.revertWithCustomError(
        factory.write.createCollection([
          "Bad",
          "BAD",
          500,
          [],
          [],
          "ipfs://test",
          10000n,
          10n,
        ]),
        factory,
        "ArrayLengthMismatch",
      );
    });

    it("Should reject zero royalty creator address and zero royalty share", async function () {
      await viem.assertions.revertWithCustomError(
        factory.write.createCollection([
          "Bad",
          "BAD",
          500,
          [zeroAddress],
          [100n],
          "ipfs://test",
          10000n,
          10n,
        ]),
        factory,
        "ZeroAddress",
      );

      await viem.assertions.revertWithCustomError(
        factory.write.createCollection([
          "Bad",
          "BAD",
          500,
          [addr1.account.address],
          [0n],
          "ipfs://test",
          10000n,
          10n,
        ]),
        factory,
        "InvalidShare",
      );
    });

    // ── Separate Mint/Royalty Receivers ──────────────────────────────────────

    describe("Separate Mint/Royalty Receivers", function () {
      it("Should deploy with different mint and royalty creators (separate model)", async function () {
        await factory.write.createCollectionWithSeparateReceivers([
          "Separate Collection",
          "SEP",
          500,
          [addr1.account.address, treasury.account.address],
          [300n, 200n],
          [treasury.account.address],
          [10000n],
          "ipfs://test",
          10000n,
          10n,
          addr1.account.address,
        ]);

        const collections = await factory.read.getDeployedCollections();
        const collectionAddress = collections[collections.length - 1];
        expect(collectionAddress).to.not.equal(zeroAddress);
        expect(await factory.read.getSplitterCount()).to.equal(1n);
      });

      it("Should support single creator for royalties, gallery for mint (gallery-first model)", async function () {
        await factory.write.createCollectionWithSeparateReceivers([
          "Gallery First",
          "GFIRST",
          500,
          [addr1.account.address, treasury.account.address],
          [300n, 200n],
          [treasury.account.address],
          [10000n],
          "ipfs://test",
          10000n,
          10n,
          addr1.account.address,
        ]);

        const collections = await factory.read.getDeployedCollections();
        expect(collections.length).to.equal(1);
      });

      it("Should support same creators for both (unified model — reuses one splitter)", async function () {
        await factory.write.createCollectionWithSeparateReceivers([
          "Unified Collection",
          "UNI",
          500,
          [addr1.account.address, treasury.account.address],
          [300n, 200n],
          [addr1.account.address, treasury.account.address],
          [300n, 200n],
          "ipfs://test",
          10000n,
          10n,
          addr1.account.address,
        ]);

        const collections = await factory.read.getDeployedCollections();
        expect(collections.length).to.equal(1);
        expect(await factory.read.getSplitterCount()).to.equal(1n);
      });

      it("Should revert on zero tipReceiver", async function () {
        await viem.assertions.revertWithCustomError(
          factory.write.createCollectionWithSeparateReceivers([
            "Bad",
            "BAD",
            500,
            [addr1.account.address],
            [100n],
            [addr1.account.address],
            [100n],
            "ipfs://test",
            10000n,
            10n,
            zeroAddress,
          ]),
          factory,
          "ZeroAddress",
        );
      });

      it("Should revert when mint creators and shares arrays mismatch", async function () {
        await viem.assertions.revertWithCustomError(
          factory.write.createCollectionWithSeparateReceivers([
            "Bad",
            "BAD",
            500,
            [addr1.account.address],
            [100n],
            [treasury.account.address, addr1.account.address],
            [100n],
            "ipfs://test",
            10000n,
            10n,
            addr1.account.address,
          ]),
          factory,
          "ArrayLengthMismatch",
        );
      });

      it("Should revert when royalty creators and shares arrays mismatch", async function () {
        await viem.assertions.revertWithCustomError(
          factory.write.createCollectionWithSeparateReceivers([
            "Bad",
            "BAD",
            500,
            [addr1.account.address, treasury.account.address],
            [100n],
            [treasury.account.address],
            [100n],
            "ipfs://test",
            10000n,
            10n,
            addr1.account.address,
          ]),
          factory,
          "ArrayLengthMismatch",
        );
      });

      it("Should reject empty mint creators, zero mint address, and zero mint share", async function () {
        await viem.assertions.revertWithCustomError(
          factory.write.createCollectionWithSeparateReceivers([
            "Bad",
            "BAD",
            500,
            [addr1.account.address],
            [100n],
            [],
            [],
            "ipfs://test",
            10000n,
            10n,
            addr1.account.address,
          ]),
          factory,
          "ArrayLengthMismatch",
        );

        await viem.assertions.revertWithCustomError(
          factory.write.createCollectionWithSeparateReceivers([
            "Bad",
            "BAD",
            500,
            [addr1.account.address],
            [100n],
            [zeroAddress],
            [100n],
            "ipfs://test",
            10000n,
            10n,
            addr1.account.address,
          ]),
          factory,
          "ZeroAddress",
        );

        await viem.assertions.revertWithCustomError(
          factory.write.createCollectionWithSeparateReceivers([
            "Bad",
            "BAD",
            500,
            [addr1.account.address],
            [100n],
            [treasury.account.address],
            [0n],
            "ipfs://test",
            10000n,
            10n,
            addr1.account.address,
          ]),
          factory,
          "InvalidShare",
        );
      });

      it("Should emit both CollectionDeployed and CollectionCreated events", async function () {
        const tx = factory.write.createCollectionWithSeparateReceivers([
          "Test Sep",
          "TESTSEP",
          500,
          [addr1.account.address, treasury.account.address],
          [300n, 200n],
          [treasury.account.address],
          [10000n],
          "ipfs://test",
          10000n,
          10n,
          addr1.account.address,
        ]);
        await viem.assertions.emit(tx, factory, "CollectionDeployed");
        await viem.assertions.emit(tx, factory, "CollectionCreated");
      });
    });
  });
});
