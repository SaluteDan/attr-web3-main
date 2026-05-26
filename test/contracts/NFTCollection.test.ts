import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress, getAddress } from "viem";
import { randomUUID } from "crypto";

const { viem, networkHelpers } = await hre.network.create();

describe("NFTCollection", function () {
  let nft: Awaited<ReturnType<typeof viem.deployContract<"NFTCollection">>>;
  let owner: Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  let recipient: typeof owner;
  let malicious: typeof owner;
  let paymentReceiver: typeof owner;
  let tipReceiver: typeof owner;
  let publicClient: Awaited<ReturnType<typeof viem.getPublicClient>>;

  // EIP-712 Constants
  const SIGNING_DOMAIN_NAME = "NFTCollection";
  const SIGNING_DOMAIN_VERSION = "1";
  let chainId: number;

  // Shared EIP-712 type definition (new voucher with basePrice + creatorTip)
  const VOUCHER_TYPES = {
    NFTVoucher: [
      { name: "recipient", type: "address" },
      { name: "uri", type: "string" },
      { name: "nonce", type: "string" },
      { name: "currency", type: "address" },
      { name: "basePrice", type: "uint256" },
      { name: "creatorTip", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  } as const;

  beforeEach(async function () {
    [owner, recipient, malicious, paymentReceiver, tipReceiver] =
      await viem.getWalletClients();
    publicClient = await viem.getPublicClient();
    chainId = await publicClient.getChainId();

    nft = await viem.deployContract("NFTCollection", [
      "Test NFT", // name_
      "TNFT", // symbol_
      owner.account.address, // initialOwner
      owner.account.address, // royaltyReceiver
      500, // royaltyFeeNumerator (5%)
      "ipfs://QmContractMeta", // contractURI_
      100n, // maxSupply_
      paymentReceiver.account.address, // paymentReceiver_
      10n, // maxMintPerWallet_
      paymentReceiver.account.address, // tipReceiver_ (same as paymentReceiver for most tests)
      zeroAddress, // attrSpender_ (disabled)
    ]);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function makeDomain(contractAddress: `0x${string}`) {
    return {
      name: SIGNING_DOMAIN_NAME,
      version: SIGNING_DOMAIN_VERSION,
      chainId,
      verifyingContract: contractAddress,
    };
  }

  async function createVoucher(
    recipientAddr: `0x${string}`,
    uri: string,
    nonce: string = randomUUID(),
  ) {
    const latestTime = await networkHelpers.time.latest();
    const deadline = BigInt(latestTime + 3600);
    const value = {
      recipient: recipientAddr,
      uri,
      nonce,
      currency: zeroAddress,
      basePrice: 0n,
      creatorTip: 0n,
      deadline,
    };
    const signature = await owner.signTypedData({
      domain: makeDomain(nft.address),
      types: VOUCHER_TYPES,
      primaryType: "NFTVoucher",
      message: value,
    });
    return { ...value, signature };
  }

  async function createVoucherWithDeadline(
    recipientAddr: `0x${string}`,
    uri: string,
    deadline: number,
    nonce: string = randomUUID(),
  ) {
    const value = {
      recipient: recipientAddr,
      uri,
      nonce,
      currency: zeroAddress,
      basePrice: 0n,
      creatorTip: 0n,
      deadline: BigInt(deadline),
    };
    const signature = await owner.signTypedData({
      domain: makeDomain(nft.address),
      types: VOUCHER_TYPES,
      primaryType: "NFTVoucher",
      message: value,
    });
    return { ...value, signature };
  }

  async function createVoucherWithPrice(
    recipientAddr: `0x${string}`,
    uri: string,
    currency: `0x${string}`,
    basePrice: bigint,
    creatorTip = 0n,
    nonce: string = randomUUID(),
  ) {
    const latestTime = await networkHelpers.time.latest();
    const value = {
      recipient: recipientAddr,
      uri,
      nonce,
      currency,
      basePrice,
      creatorTip,
      deadline: BigInt(latestTime + 3600),
    };
    const signature = await owner.signTypedData({
      domain: makeDomain(nft.address),
      types: VOUCHER_TYPES,
      primaryType: "NFTVoucher",
      message: value,
    });
    return { ...value, signature };
  }

  function emptyPermit(deadline: bigint) {
    return {
      v: 0,
      r: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      s: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      deadline,
      nonce: 0n,
    };
  }

  async function deployErc20() {
    return viem.deployContract("ATTRToken", [
      parseEther("1000000"),
      parseEther("1000"),
      owner.account.address,
    ]);
  }

  // Helper to build an ERC20 voucher using a custom contract address
  async function makeVoucherFor(
    contractAddress: `0x${string}`,
    recipientAddr: `0x${string}`,
    currency: `0x${string}`,
    basePrice: bigint,
    creatorTip: bigint,
    nonce: string,
  ) {
    const latestTime = await networkHelpers.time.latest();
    const value = {
      recipient: recipientAddr,
      uri: "ipfs://x",
      nonce,
      currency,
      basePrice,
      creatorTip,
      deadline: BigInt(latestTime + 3600),
    };
    const signature = await owner.signTypedData({
      domain: makeDomain(contractAddress),
      types: VOUCHER_TYPES,
      primaryType: "NFTVoucher",
      message: value,
    });
    return { ...value, signature };
  }

  // ─── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await nft.read.name()).to.equal("Test NFT");
      expect(await nft.read.symbol()).to.equal("TNFT");
    });

    it("Should set correct owner", async function () {
      expect(await nft.read.owner()).to.equal(
        getAddress(owner.account.address),
      );
    });

    it("Should set correct max supply", async function () {
      expect(await nft.read.MAX_SUPPLY()).to.equal(100n);
    });

    it("Should set correct max mint per wallet", async function () {
      expect(await nft.read.MAX_MINT_PER_WALLET()).to.equal(10n);
    });

    it("Should set correct payment receiver", async function () {
      expect(await nft.read.paymentReceiver()).to.equal(
        getAddress(paymentReceiver.account.address),
      );
    });

    it("Should return correct contractURI", async function () {
      expect(await nft.read.contractURI()).to.equal("ipfs://QmContractMeta");
    });

    it("Should start totalSupply at 0", async function () {
      expect(await nft.read.totalSupply()).to.equal(0n);
    });

    it("Should start getNextTokenId at 1", async function () {
      expect(await nft.read.getNextTokenId()).to.equal(1n);
    });
  });

  // ─── setContractURI ────────────────────────────────────────────────────────

  describe("setContractURI", function () {
    it("Should allow owner to update contractURI", async function () {
      const newURI = "ipfs://QmUpdated";
      await viem.assertions.emitWithArgs(
        nft.write.setContractURI([newURI]),
        nft,
        "ContractURIUpdated",
        ["ipfs://QmContractMeta", newURI],
      );
      expect(await nft.read.contractURI()).to.equal(newURI);
    });

    it("Should reject non-owner update", async function () {
      await viem.assertions.revertWithCustomError(
        nft.write.setContractURI(["ipfs://hack"], {
          account: malicious.account,
        }),
        nft,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ─── setTipReceiver ────────────────────────────────────────────────────────

  describe("setTipReceiver", function () {
    it("Should allow owner to update tipReceiver", async function () {
      await viem.assertions.emitWithArgs(
        nft.write.setTipReceiver([tipReceiver.account.address]),
        nft,
        "TipReceiverUpdated",
        [
          getAddress(paymentReceiver.account.address),
          getAddress(tipReceiver.account.address),
        ],
      );
      expect(await nft.read.tipReceiver()).to.equal(
        getAddress(tipReceiver.account.address),
      );
    });

    it("Should reject zero address", async function () {
      await viem.assertions.revertWithCustomError(
        nft.write.setTipReceiver([zeroAddress]),
        nft,
        "ZeroAddress",
      );
    });

    it("Should reject non-owner update", async function () {
      await viem.assertions.revertWithCustomError(
        nft.write.setTipReceiver([tipReceiver.account.address], {
          account: malicious.account,
        }),
        nft,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ─── mintTo (owner minting) ────────────────────────────────────────────────

  describe("mintTo", function () {
    it("Should allow owner to mintTo a recipient", async function () {
      await viem.assertions.emitWithArgs(
        nft.write.mintTo([recipient.account.address, "ipfs://QmA"]),
        nft,
        "NFTMinted",
        [getAddress(recipient.account.address), 1n, "ipfs://QmA"],
      );
      expect(await nft.read.ownerOf([1n])).to.equal(
        getAddress(recipient.account.address),
      );
      expect(await nft.read.totalSupply()).to.equal(1n);
    });

    it("Should reject mintTo from non-owner", async function () {
      await viem.assertions.revertWithCustomError(
        nft.write.mintTo([recipient.account.address, "ipfs://QmA"], {
          account: malicious.account,
        }),
        nft,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should reject mintTo to zero address", async function () {
      await viem.assertions.revertWithCustomError(
        nft.write.mintTo([zeroAddress, "ipfs://QmA"]),
        nft,
        "ZeroAddress",
      );
    });

    it("Should reject mintTo with empty URI", async function () {
      await viem.assertions.revertWithCustomError(
        nft.write.mintTo([recipient.account.address, ""]),
        nft,
        "EmptyURI",
      );
    });

    it("Should enforce max supply via mintTo", async function () {
      const small = await viem.deployContract("NFTCollection", [
        "Small",
        "SM",
        owner.account.address,
        owner.account.address,
        0,
        "ipfs://",
        2n,
        paymentReceiver.account.address,
        5n,
        paymentReceiver.account.address,
        zeroAddress,
      ]);
      await small.write.mintTo([recipient.account.address, "ipfs://1"]);
      await small.write.mintTo([recipient.account.address, "ipfs://2"]);
      await viem.assertions.revertWithCustomError(
        small.write.mintTo([recipient.account.address, "ipfs://3"]),
        small,
        "MaxSupplyExceeded",
      );
    });

    it("mintTo bypasses per-wallet counter (getMintedCount stays 0)", async function () {
      expect(
        await nft.read.getMintedCount([recipient.account.address]),
      ).to.equal(0n);
      await nft.write.mintTo([recipient.account.address, "ipfs://QmA"]);
      expect(
        await nft.read.getMintedCount([recipient.account.address]),
      ).to.equal(0n);
      expect(await nft.read.totalSupply()).to.equal(1n);
    });
  });

  // ─── setTokenURI ───────────────────────────────────────────────────────────

  describe("setTokenURI", function () {
    it("Should allow owner to update token URI", async function () {
      await nft.write.mintTo([recipient.account.address, "ipfs://QmOld"]);
      await nft.write.setTokenURI([1n, "ipfs://QmNew"]);
      expect(await nft.read.tokenURI([1n])).to.equal("ipfs://QmNew");
    });

    it("Should reject setTokenURI from non-owner", async function () {
      await nft.write.mintTo([recipient.account.address, "ipfs://QmOld"]);
      await viem.assertions.revertWithCustomError(
        nft.write.setTokenURI([1n, "ipfs://QmNew"], {
          account: malicious.account,
        }),
        nft,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ─── Royalties ─────────────────────────────────────────────────────────────

  describe("Royalties (ERC2981)", function () {
    it("Should return correct royalty info", async function () {
      await nft.write.mintTo([recipient.account.address, "ipfs://QmA"]);
      const [receiver, amount] = await nft.read.royaltyInfo([1n, 10000n]);
      expect(receiver).to.equal(getAddress(owner.account.address));
      expect(amount).to.equal(500n); // 5%
    });
  });

  // ─── supportsInterface ─────────────────────────────────────────────────────

  describe("supportsInterface", function () {
    it("Should support ERC721 interface", async function () {
      expect(await nft.read.supportsInterface(["0x80ac58cd"])).to.be.true;
    });
    it("Should support ERC2981 interface", async function () {
      expect(await nft.read.supportsInterface(["0x2a55205a"])).to.be.true;
    });
  });

  // ─── Pause / Unpause ───────────────────────────────────────────────────────

  describe("Pause / Unpause", function () {
    it("Should allow owner to pause and unpause", async function () {
      await nft.write.pause();
      const voucher = await createVoucher(
        recipient.account.address,
        "ipfs://QmA",
      );
      const permit = emptyPermit(voucher.deadline);
      await viem.assertions.revertWithCustomError(
        nft.write.redeem([voucher, permit], { account: recipient.account }),
        nft,
        "EnforcedPause",
      );
      await nft.write.unpause();
      await viem.assertions.emit(
        nft.write.redeem([voucher, permit], { account: recipient.account }),
        nft,
        "NFTMinted",
      );
    });

    it("Should reject pause from non-owner", async function () {
      await viem.assertions.revertWithCustomError(
        nft.write.pause({ account: malicious.account }),
        nft,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should reject mintTo while paused", async function () {
      await nft.write.pause();
      await viem.assertions.revertWithCustomError(
        nft.write.mintTo([recipient.account.address, "ipfs://QmA"]),
        nft,
        "EnforcedPause",
      );
    });
  });

  // ─── View helpers ──────────────────────────────────────────────────────────

  describe("View helpers", function () {
    it("Should increment totalSupply and getNextTokenId after mints", async function () {
      await nft.write.mintTo([recipient.account.address, "ipfs://1"]);
      await nft.write.mintTo([recipient.account.address, "ipfs://2"]);
      expect(await nft.read.totalSupply()).to.equal(2n);
      expect(await nft.read.getNextTokenId()).to.equal(3n);
    });

    it("Should track getMintedCount per wallet for voucher mints", async function () {
      const voucher = await createVoucher(
        recipient.account.address,
        "ipfs://QmA",
      );
      const permit = emptyPermit(voucher.deadline);
      await nft.write.redeem([voucher, permit], {
        account: recipient.account,
      });
      expect(
        await nft.read.getMintedCount([recipient.account.address]),
      ).to.equal(1n);
    });
  });

  // ─── redeem ────────────────────────────────────────────────────────────────

  describe("redeem", function () {
    it("Should mint an NFT with a valid voucher and permit", async function () {
      const uri = "ipfs://QmTest";
      const voucher = await createVoucher(recipient.account.address, uri);
      const permit = emptyPermit(voucher.deadline);

      await viem.assertions.emitWithArgs(
        nft.write.redeem([voucher, permit], { account: recipient.account }),
        nft,
        "NFTMinted",
        [getAddress(recipient.account.address), 1n, uri],
      );

      expect(await nft.read.ownerOf([1n])).to.equal(
        getAddress(recipient.account.address),
      );
      expect(await nft.read.tokenURI([1n])).to.equal(uri);
    });

    it("Should fail if the voucher is modified", async function () {
      const voucher = await createVoucher(
        recipient.account.address,
        "ipfs://QmTest",
      );
      const forgedVoucher = { ...voucher, uri: "ipfs://QmHacked" };
      const permit = emptyPermit(voucher.deadline);

      await viem.assertions.revertWithCustomError(
        nft.write.redeem([forgedVoucher, permit], {
          account: recipient.account,
        }),
        nft,
        "InvalidSignature",
      );
    });

    it("Should fail if the signature is from a non-owner", async function () {
      const latestTime = await networkHelpers.time.latest();
      const nonce = randomUUID();
      const value = {
        recipient: recipient.account.address,
        uri: "ipfs://QmTest",
        nonce,
        currency: zeroAddress,
        basePrice: 0n,
        creatorTip: 0n,
        deadline: BigInt(latestTime + 3600),
      };
      const signature = await malicious.signTypedData({
        domain: makeDomain(nft.address),
        types: VOUCHER_TYPES,
        primaryType: "NFTVoucher",
        message: value,
      });
      const voucher = { ...value, signature };
      const permit = emptyPermit(value.deadline);

      await viem.assertions.revertWithCustomError(
        nft.write.redeem([voucher, permit], { account: recipient.account }),
        nft,
        "InvalidSignature",
      );
    });

    it("Should prevent replay attacks (using the same voucher twice)", async function () {
      const voucher = await createVoucher(
        recipient.account.address,
        "ipfs://QmTest",
      );
      const permit = emptyPermit(voucher.deadline);

      await nft.write.redeem([voucher, permit], {
        account: recipient.account,
      });

      await viem.assertions.revertWithCustomError(
        nft.write.redeem([voucher, permit], { account: recipient.account }),
        nft,
        "VoucherAlreadyUsed",
      );
    });

    it("Should allow minting by any caller with a valid voucher", async function () {
      const uri = "ipfs://QmTest";
      const voucher = await createVoucher(recipient.account.address, uri);
      const permit = emptyPermit(voucher.deadline);

      await viem.assertions.emitWithArgs(
        nft.write.redeem([voucher, permit], { account: malicious.account }),
        nft,
        "NFTMinted",
        [getAddress(recipient.account.address), 1n, uri],
      );

      expect(await nft.read.ownerOf([1n])).to.equal(
        getAddress(recipient.account.address),
      );
    });

    it("Should reject expired voucher", async function () {
      const latestTime = await networkHelpers.time.latest();
      const voucher = await createVoucherWithDeadline(
        recipient.account.address,
        "ipfs://QmA",
        latestTime - 1,
      );
      const permit = emptyPermit(voucher.deadline);
      await viem.assertions.revertWithCustomError(
        nft.write.redeem([voucher, permit], { account: recipient.account }),
        nft,
        "VoucherExpired",
      );
    });

    it("Should enforce max mint per wallet", async function () {
      const small = await viem.deployContract("NFTCollection", [
        "Small",
        "SM",
        owner.account.address,
        owner.account.address,
        0,
        "ipfs://",
        1000n,
        paymentReceiver.account.address,
        2n,
        paymentReceiver.account.address,
        zeroAddress,
      ]);
      const contractAddr = small.address;
      const latestTime = await networkHelpers.time.latest();
      const permit = emptyPermit(BigInt(latestTime + 3600));
      const makeV = async (n: string) => {
        const value = {
          recipient: recipient.account.address,
          uri: "ipfs://x",
          nonce: n,
          currency: zeroAddress,
          basePrice: 0n,
          creatorTip: 0n,
          deadline: BigInt(latestTime + 3600),
        };
        const signature = await owner.signTypedData({
          domain: makeDomain(contractAddr),
          types: VOUCHER_TYPES,
          primaryType: "NFTVoucher",
          message: value,
        });
        return { ...value, signature };
      };
      await small.write.redeem([await makeV("n1"), permit], {
        account: recipient.account,
      });
      await small.write.redeem([await makeV("n2"), permit], {
        account: recipient.account,
      });
      await viem.assertions.revertWithCustomError(
        small.write.redeem([await makeV("n3"), permit], {
          account: recipient.account,
        }),
        small,
        "MaxMintPerWalletExceeded",
      );
    });

    it("Should mint with ETH payment and forward basePrice to paymentReceiver", async function () {
      const price = parseEther("0.1");
      const voucher = await createVoucherWithPrice(
        recipient.account.address,
        "ipfs://QmEth",
        zeroAddress,
        price,
      );
      const permit = emptyPermit(voucher.deadline);

      const before = await publicClient.getBalance({
        address: paymentReceiver.account.address,
      });
      await nft.write.redeem([voucher, permit], {
        account: recipient.account,
        value: price,
      });
      const after = await publicClient.getBalance({
        address: paymentReceiver.account.address,
      });
      expect(after - before).to.equal(price);
    });

    it("Should reject non-exact ETH for paid voucher", async function () {
      const price = parseEther("0.1");
      const voucher = await createVoucherWithPrice(
        recipient.account.address,
        "ipfs://QmEth",
        zeroAddress,
        price,
      );
      const permit = emptyPermit(voucher.deadline);
      await viem.assertions.revertWithCustomError(
        nft.write.redeem([voucher, permit], {
          account: recipient.account,
          value: parseEther("0.05"),
        }),
        nft,
        "ExactETHRequired",
      );
    });

    it("Should reject ETH sent alongside ERC20 voucher", async function () {
      const token = await deployErc20();
      const price = parseEther("10");
      await token.write.transfer([recipient.account.address, price]);
      await token.write.approve([nft.address, price], {
        account: recipient.account,
      });
      const voucher = await createVoucherWithPrice(
        recipient.account.address,
        "ipfs://QmERC",
        token.address,
        price,
      );
      const permit = emptyPermit(voucher.deadline);
      await viem.assertions.revertWithCustomError(
        nft.write.redeem([voucher, permit], {
          account: recipient.account,
          value: parseEther("0.01"),
        }),
        nft,
        "ETHWithERC20Payment",
      );
    });
  });

  // ─── base + tip routing ────────────────────────────────────────────────────

  describe("base + tip routing", function () {
    let tipNft: typeof nft;

    beforeEach(async function () {
      tipNft = await viem.deployContract("NFTCollection", [
        "Tip NFT",
        "TNFT2",
        owner.account.address,
        owner.account.address,
        0,
        "ipfs://",
        100n,
        paymentReceiver.account.address,
        10n,
        tipReceiver.account.address, // separate tipReceiver
        zeroAddress,
      ]);
    });

    it("Should split ETH: basePrice → paymentReceiver, creatorTip → tipReceiver", async function () {
      const base = parseEther("0.1");
      const tip = parseEther("0.02");
      const latestTime = await networkHelpers.time.latest();
      const value = {
        recipient: recipient.account.address,
        uri: "ipfs://split",
        nonce: randomUUID(),
        currency: zeroAddress,
        basePrice: base,
        creatorTip: tip,
        deadline: BigInt(latestTime + 3600),
      };
      const sig = await owner.signTypedData({
        domain: makeDomain(tipNft.address),
        types: VOUCHER_TYPES,
        primaryType: "NFTVoucher",
        message: value,
      });
      const voucher = { ...value, signature: sig };
      const permit = emptyPermit(value.deadline);

      const beforePR = await publicClient.getBalance({
        address: paymentReceiver.account.address,
      });
      const beforeTip = await publicClient.getBalance({
        address: tipReceiver.account.address,
      });

      await tipNft.write.redeem([voucher, permit], {
        account: recipient.account,
        value: base + tip,
      });

      const afterPR = await publicClient.getBalance({
        address: paymentReceiver.account.address,
      });
      const afterTip = await publicClient.getBalance({
        address: tipReceiver.account.address,
      });

      expect(afterPR - beforePR).to.equal(base);
      expect(afterTip - beforeTip).to.equal(tip);
    });

    it("Should reject if msg.value != basePrice + creatorTip", async function () {
      const base = parseEther("0.1");
      const tip = parseEther("0.02");
      const latestTime = await networkHelpers.time.latest();
      const value = {
        recipient: recipient.account.address,
        uri: "ipfs://split",
        nonce: randomUUID(),
        currency: zeroAddress,
        basePrice: base,
        creatorTip: tip,
        deadline: BigInt(latestTime + 3600),
      };
      const sig = await owner.signTypedData({
        domain: makeDomain(tipNft.address),
        types: VOUCHER_TYPES,
        primaryType: "NFTVoucher",
        message: value,
      });
      const voucher = { ...value, signature: sig };
      const permit = emptyPermit(value.deadline);

      // Only base, missing tip
      await viem.assertions.revertWithCustomError(
        tipNft.write.redeem([voucher, permit], {
          account: recipient.account,
          value: base,
        }),
        tipNft,
        "ExactETHRequired",
      );
    });
  });

  // ─── redeemWithApproval (ERC20 + 4337) ────────────────────────────────────
  //
  // `redeemWithApproval` deliberately pulls ERC20 payment from `voucher.recipient`
  // (NOT `msg.sender`) so that smart-account flows using `wallet_sendCalls` —
  // where msg.sender is the EntryPoint/Bundler, not the user — can still mint.
  //
  // See: frontend/docs/CONTRACT_FIX_NEEDED.md. These tests lock in that
  // behavior so anyone who "helpfully" changes it to msg.sender will fail CI.

  describe("redeemWithApproval (ERC20 + 4337)", function () {
    const MINT_PRICE = parseEther("10");

    async function createErc20Voucher(
      recipientAddr: `0x${string}`,
      uri: string,
      currency: `0x${string}`,
      basePrice: bigint,
      nonce: string = randomUUID(),
    ) {
      const latestTime = await networkHelpers.time.latest();
      const value = {
        recipient: recipientAddr,
        uri,
        nonce,
        currency,
        basePrice,
        creatorTip: 0n,
        deadline: BigInt(latestTime + 3600),
      };
      const signature = await owner.signTypedData({
        domain: makeDomain(nft.address),
        types: VOUCHER_TYPES,
        primaryType: "NFTVoucher",
        message: value,
      });
      return { ...value, signature };
    }

    it("Should mint with ETH payment and forward funds", async function () {
      const price = parseEther("0.2");
      const voucher = await createErc20Voucher(
        recipient.account.address,
        "ipfs://eth-approval",
        zeroAddress,
        price,
      );

      const initialBalance = await publicClient.getBalance({
        address: paymentReceiver.account.address,
      });

      await viem.assertions.emitWithArgs(
        nft.write.redeemWithApproval([voucher], {
          account: recipient.account,
          value: price,
        }),
        nft,
        "NFTMinted",
        [getAddress(recipient.account.address), 1n, "ipfs://eth-approval"],
      );

      const finalBalance = await publicClient.getBalance({
        address: paymentReceiver.account.address,
      });
      expect(finalBalance - initialBalance).to.equal(price);
    });

    it("Should reject non-exact ETH for redeemWithApproval", async function () {
      const price = parseEther("0.2");
      const voucher = await createErc20Voucher(
        recipient.account.address,
        "ipfs://eth-approval",
        zeroAddress,
        price,
      );

      await viem.assertions.revertWithCustomError(
        nft.write.redeemWithApproval([voucher], {
          account: recipient.account,
          value: price - 1n,
        }),
        nft,
        "ExactETHRequired",
      );
    });

    it("Should mint when recipient calls directly (EOA path)", async function () {
      const token = await deployErc20();
      const uri = "ipfs://erc20-eoa";

      await token.write.transfer([recipient.account.address, MINT_PRICE]);
      await token.write.approve([nft.address, MINT_PRICE], {
        account: recipient.account,
      });

      const voucher = await createErc20Voucher(
        recipient.account.address,
        uri,
        token.address,
        MINT_PRICE,
      );

      const receiverBefore = await token.read.balanceOf([
        paymentReceiver.account.address,
      ]);

      await viem.assertions.emitWithArgs(
        nft.write.redeemWithApproval([voucher], {
          account: recipient.account,
        }),
        nft,
        "NFTMinted",
        [getAddress(recipient.account.address), 1n, uri],
      );

      expect(await nft.read.ownerOf([1n])).to.equal(
        getAddress(recipient.account.address),
      );
      expect(await token.read.balanceOf([recipient.account.address])).to.equal(
        0n,
      );
      expect(
        await token.read.balanceOf([paymentReceiver.account.address]),
      ).to.equal(receiverBefore + MINT_PRICE);
    });

    it("Should mint when a third party (bundler) submits on recipient's behalf — 4337 path", async function () {
      // Critical ERC-4337 scenario: smart account approves the NFT contract,
      // then EntryPoint/Bundler relays the call. msg.sender != voucher.recipient,
      // but the pull still must come from voucher.recipient (who granted allowance).
      const token = await deployErc20();
      const uri = "ipfs://erc20-bundler";

      await token.write.transfer([recipient.account.address, MINT_PRICE]);
      await token.write.approve([nft.address, MINT_PRICE], {
        account: recipient.account,
      });

      const voucher = await createErc20Voucher(
        recipient.account.address,
        uri,
        token.address,
        MINT_PRICE,
      );
      const receiverBefore = await token.read.balanceOf([
        paymentReceiver.account.address,
      ]);

      await viem.assertions.emitWithArgs(
        nft.write.redeemWithApproval([voucher], {
          account: malicious.account,
        }),
        nft,
        "NFTMinted",
        [getAddress(recipient.account.address), 1n, uri],
      );

      expect(await nft.read.ownerOf([1n])).to.equal(
        getAddress(recipient.account.address),
      );
      expect(await token.read.balanceOf([recipient.account.address])).to.equal(
        0n,
      );
      expect(await token.read.balanceOf([malicious.account.address])).to.equal(
        0n,
      );
      expect(
        await token.read.balanceOf([paymentReceiver.account.address]),
      ).to.equal(receiverBefore + MINT_PRICE);
    });

    it("Should revert when the recipient has not approved the NFT contract", async function () {
      const token = await deployErc20();
      const uri = "ipfs://erc20-no-approval";

      await token.write.transfer([recipient.account.address, MINT_PRICE]);
      // No approve

      const voucher = await createErc20Voucher(
        recipient.account.address,
        uri,
        token.address,
        MINT_PRICE,
      );

      await viem.assertions.revertWithCustomError(
        nft.write.redeemWithApproval([voucher], {
          account: malicious.account,
        }),
        token,
        "ERC20InsufficientAllowance",
      );
    });

    it("Should revert when a malicious caller crafts a voucher for a different recipient who hasn't approved", async function () {
      const token = await deployErc20();
      const uri = "ipfs://erc20-drain-attempt";

      await token.write.transfer([malicious.account.address, MINT_PRICE]);
      await token.write.approve([nft.address, MINT_PRICE], {
        account: malicious.account,
      });

      // Voucher names `recipient` (not malicious), but recipient has no allowance
      const voucher = await createErc20Voucher(
        recipient.account.address,
        uri,
        token.address,
        MINT_PRICE,
      );

      await viem.assertions.revertWithCustomError(
        nft.write.redeemWithApproval([voucher], {
          account: malicious.account,
        }),
        token,
        "ERC20InsufficientAllowance",
      );
    });
  });
});
