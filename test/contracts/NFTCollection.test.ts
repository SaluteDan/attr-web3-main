import { expect } from "chai";
import { ethers } from "hardhat";
import { NFTCollection } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { randomUUID } from "crypto";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("NFTCollection", function () {
  let nft: NFTCollection;
  let owner: SignerWithAddress;
  let recipient: SignerWithAddress;
  let malicious: SignerWithAddress;
  let paymentReceiver: SignerWithAddress;
  let tipReceiver: SignerWithAddress;

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
  };

  beforeEach(async function () {
    [owner, recipient, malicious, paymentReceiver, tipReceiver] =
      await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    chainId = Number(network.chainId);

    const NFTContract = await ethers.getContractFactory("NFTCollection");
    nft = await NFTContract.deploy(
      "Test NFT", // name_
      "TNFT", // symbol_
      owner.address, // initialOwner
      owner.address, // royaltyReceiver
      500, // royaltyFeeNumerator (5%)
      "ipfs://QmContractMeta", // contractURI_
      100, // maxSupply_
      paymentReceiver.address, // paymentReceiver_
      10, // maxMintPerWallet_
      paymentReceiver.address, // tipReceiver_ (same as paymentReceiver for most tests)
      ethers.ZeroAddress, // attrSpender_ (disabled)
    );
    await nft.waitForDeployment();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function makeDomain(contractAddress: string) {
    return {
      name: SIGNING_DOMAIN_NAME,
      version: SIGNING_DOMAIN_VERSION,
      chainId,
      verifyingContract: contractAddress,
    };
  }

  async function createVoucher(
    recipientAddr: string,
    uri: string,
    nonce: string = randomUUID(),
  ) {
    const contractAddress = await nft.getAddress();
    const latestTime = await time.latest();
    const deadline = latestTime + 3600;
    const value = {
      recipient: recipientAddr,
      uri,
      nonce,
      currency: ethers.ZeroAddress,
      basePrice: 0n,
      creatorTip: 0n,
      deadline,
    };
    const signature = await owner.signTypedData(
      await makeDomain(contractAddress),
      VOUCHER_TYPES,
      value,
    );
    return { ...value, signature };
  }

  async function createVoucherWithDeadline(
    recipientAddr: string,
    uri: string,
    deadline: number,
    nonce: string = randomUUID(),
  ) {
    const contractAddress = await nft.getAddress();
    const value = {
      recipient: recipientAddr,
      uri,
      nonce,
      currency: ethers.ZeroAddress,
      basePrice: 0n,
      creatorTip: 0n,
      deadline,
    };
    const signature = await owner.signTypedData(
      await makeDomain(contractAddress),
      VOUCHER_TYPES,
      value,
    );
    return { ...value, signature };
  }

  async function createVoucherWithPrice(
    recipientAddr: string,
    uri: string,
    currency: string,
    basePrice: bigint,
    creatorTip = 0n,
    nonce: string = randomUUID(),
  ) {
    const contractAddress = await nft.getAddress();
    const latestTime = await time.latest();
    const value = {
      recipient: recipientAddr,
      uri,
      nonce,
      currency,
      basePrice,
      creatorTip,
      deadline: latestTime + 3600,
    };
    const signature = await owner.signTypedData(
      await makeDomain(contractAddress),
      VOUCHER_TYPES,
      value,
    );
    return { ...value, signature };
  }

  function emptyPermit(deadline: number) {
    return {
      v: 0,
      r: "0x0000000000000000000000000000000000000000000000000000000000000000",
      s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      deadline,
      nonce: 0,
    };
  }

  async function deployErc20() {
    const ATTR = await ethers.getContractFactory("ATTRToken");
    const token = await ATTR.deploy(
      ethers.parseEther("1000000"),
      ethers.parseEther("1000"),
      owner.address,
    );
    await token.waitForDeployment();
    return token;
  }

  // Helper to build an ERC20 voucher using a custom contract address
  async function makeVoucherFor(
    contractAddress: string,
    recipientAddr: string,
    currency: string,
    basePrice: bigint,
    creatorTip: bigint,
    nonce: string,
  ) {
    const latestTime = await time.latest();
    const value = {
      recipient: recipientAddr,
      uri: "ipfs://x",
      nonce,
      currency,
      basePrice,
      creatorTip,
      deadline: latestTime + 3600,
    };
    const signature = await owner.signTypedData(
      {
        name: SIGNING_DOMAIN_NAME,
        version: SIGNING_DOMAIN_VERSION,
        chainId,
        verifyingContract: contractAddress,
      },
      VOUCHER_TYPES,
      value,
    );
    return { ...value, signature };
  }

  // ─── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await nft.name()).to.equal("Test NFT");
      expect(await nft.symbol()).to.equal("TNFT");
    });

    it("Should set correct owner", async function () {
      expect(await nft.owner()).to.equal(owner.address);
    });

    it("Should set correct max supply", async function () {
      expect(await nft.MAX_SUPPLY()).to.equal(100n);
    });

    it("Should set correct max mint per wallet", async function () {
      expect(await nft.MAX_MINT_PER_WALLET()).to.equal(10n);
    });

    it("Should set correct payment receiver", async function () {
      expect(await nft.paymentReceiver()).to.equal(paymentReceiver.address);
    });

    it("Should return correct contractURI", async function () {
      expect(await nft.contractURI()).to.equal("ipfs://QmContractMeta");
    });

    it("Should start totalSupply at 0", async function () {
      expect(await nft.totalSupply()).to.equal(0n);
    });

    it("Should start getNextTokenId at 1", async function () {
      expect(await nft.getNextTokenId()).to.equal(1n);
    });
  });

  // ─── setContractURI ────────────────────────────────────────────────────────

  describe("setContractURI", function () {
    it("Should allow owner to update contractURI", async function () {
      const newURI = "ipfs://QmUpdated";
      await expect(nft.setContractURI(newURI))
        .to.emit(nft, "ContractURIUpdated")
        .withArgs("ipfs://QmContractMeta", newURI);
      expect(await nft.contractURI()).to.equal(newURI);
    });

    it("Should reject non-owner update", async function () {
      await expect(
        nft.connect(malicious).setContractURI("ipfs://hack"),
      ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });
  });

  // ─── setTipReceiver ────────────────────────────────────────────────────────

  describe("setTipReceiver", function () {
    it("Should allow owner to update tipReceiver", async function () {
      await expect(nft.setTipReceiver(tipReceiver.address))
        .to.emit(nft, "TipReceiverUpdated")
        .withArgs(paymentReceiver.address, tipReceiver.address);
      expect(await nft.tipReceiver()).to.equal(tipReceiver.address);
    });

    it("Should reject zero address", async function () {
      await expect(
        nft.setTipReceiver(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(nft, "ZeroAddress");
    });

    it("Should reject non-owner update", async function () {
      await expect(
        nft.connect(malicious).setTipReceiver(tipReceiver.address),
      ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });
  });

  // ─── mintTo (owner minting) ────────────────────────────────────────────────

  describe("mintTo", function () {
    it("Should allow owner to mintTo a recipient", async function () {
      await expect(nft.connect(owner).mintTo(recipient.address, "ipfs://QmA"))
        .to.emit(nft, "NFTMinted")
        .withArgs(recipient.address, 1, "ipfs://QmA");
      expect(await nft.ownerOf(1)).to.equal(recipient.address);
      expect(await nft.totalSupply()).to.equal(1n);
    });

    it("Should reject mintTo from non-owner", async function () {
      await expect(
        nft.connect(malicious).mintTo(recipient.address, "ipfs://QmA"),
      ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });

    it("Should reject mintTo to zero address", async function () {
      await expect(
        nft.connect(owner).mintTo(ethers.ZeroAddress, "ipfs://QmA"),
      ).to.be.revertedWithCustomError(nft, "ZeroAddress");
    });

    it("Should reject mintTo with empty URI", async function () {
      await expect(
        nft.connect(owner).mintTo(recipient.address, ""),
      ).to.be.revertedWithCustomError(nft, "EmptyURI");
    });

    it("Should enforce max supply via mintTo", async function () {
      const SmallNFT = await ethers.getContractFactory("NFTCollection");
      const small = await SmallNFT.deploy(
        "Small",
        "SM",
        owner.address,
        owner.address,
        0,
        "ipfs://",
        2,
        paymentReceiver.address,
        5,
        paymentReceiver.address,
        ethers.ZeroAddress,
      );
      await small.mintTo(recipient.address, "ipfs://1");
      await small.mintTo(recipient.address, "ipfs://2");
      await expect(
        small.mintTo(recipient.address, "ipfs://3"),
      ).to.be.revertedWithCustomError(small, "MaxSupplyExceeded");
    });

    it("mintTo bypasses per-wallet counter (getMintedCount stays 0)", async function () {
      expect(await nft.getMintedCount(recipient.address)).to.equal(0n);
      await nft.connect(owner).mintTo(recipient.address, "ipfs://QmA");
      expect(await nft.getMintedCount(recipient.address)).to.equal(0n);
      expect(await nft.totalSupply()).to.equal(1n);
    });
  });

  // ─── setTokenURI ───────────────────────────────────────────────────────────

  describe("setTokenURI", function () {
    it("Should allow owner to update token URI", async function () {
      await nft.connect(owner).mintTo(recipient.address, "ipfs://QmOld");
      await nft.connect(owner).setTokenURI(1, "ipfs://QmNew");
      expect(await nft.tokenURI(1)).to.equal("ipfs://QmNew");
    });

    it("Should reject setTokenURI from non-owner", async function () {
      await nft.connect(owner).mintTo(recipient.address, "ipfs://QmOld");
      await expect(
        nft.connect(malicious).setTokenURI(1, "ipfs://QmNew"),
      ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Royalties ─────────────────────────────────────────────────────────────

  describe("Royalties (ERC2981)", function () {
    it("Should return correct royalty info", async function () {
      await nft.connect(owner).mintTo(recipient.address, "ipfs://QmA");
      const [receiver, amount] = await nft.royaltyInfo(1, 10000n);
      expect(receiver).to.equal(owner.address);
      expect(amount).to.equal(500n); // 5%
    });
  });

  // ─── supportsInterface ─────────────────────────────────────────────────────

  describe("supportsInterface", function () {
    it("Should support ERC721 interface", async function () {
      expect(await nft.supportsInterface("0x80ac58cd")).to.be.true;
    });
    it("Should support ERC2981 interface", async function () {
      expect(await nft.supportsInterface("0x2a55205a")).to.be.true;
    });
  });

  // ─── Pause / Unpause ───────────────────────────────────────────────────────

  describe("Pause / Unpause", function () {
    it("Should allow owner to pause and unpause", async function () {
      await nft.connect(owner).pause();
      const voucher = await createVoucher(recipient.address, "ipfs://QmA");
      const permit = emptyPermit(voucher.deadline);
      await expect(
        nft.connect(recipient).redeem(voucher, permit),
      ).to.be.revertedWithCustomError(nft, "EnforcedPause");
      await nft.connect(owner).unpause();
      await expect(nft.connect(recipient).redeem(voucher, permit)).to.emit(
        nft,
        "NFTMinted",
      );
    });

    it("Should reject pause from non-owner", async function () {
      await expect(
        nft.connect(malicious).pause(),
      ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });

    it("Should reject mintTo while paused", async function () {
      await nft.connect(owner).pause();
      await expect(
        nft.connect(owner).mintTo(recipient.address, "ipfs://QmA"),
      ).to.be.revertedWithCustomError(nft, "EnforcedPause");
    });
  });

  // ─── View helpers ──────────────────────────────────────────────────────────

  describe("View helpers", function () {
    it("Should increment totalSupply and getNextTokenId after mints", async function () {
      await nft.connect(owner).mintTo(recipient.address, "ipfs://1");
      await nft.connect(owner).mintTo(recipient.address, "ipfs://2");
      expect(await nft.totalSupply()).to.equal(2n);
      expect(await nft.getNextTokenId()).to.equal(3n);
    });

    it("Should track getMintedCount per wallet for voucher mints", async function () {
      const voucher = await createVoucher(recipient.address, "ipfs://QmA");
      const permit = emptyPermit(voucher.deadline);
      await nft.connect(recipient).redeem(voucher, permit);
      expect(await nft.getMintedCount(recipient.address)).to.equal(1n);
    });
  });

  // ─── redeem ────────────────────────────────────────────────────────────────

  describe("redeem", function () {
    it("Should mint an NFT with a valid voucher and permit", async function () {
      const uri = "ipfs://QmTest";
      const voucher = await createVoucher(recipient.address, uri);
      const permit = emptyPermit(voucher.deadline);

      await expect(nft.connect(recipient).redeem(voucher, permit))
        .to.emit(nft, "NFTMinted")
        .withArgs(recipient.address, 1, uri);

      expect(await nft.ownerOf(1)).to.equal(recipient.address);
      expect(await nft.tokenURI(1)).to.equal(uri);
    });

    it("Should fail if the voucher is modified", async function () {
      const voucher = await createVoucher(recipient.address, "ipfs://QmTest");
      const forgedVoucher = { ...voucher, uri: "ipfs://QmHacked" };
      const permit = emptyPermit(voucher.deadline);

      await expect(
        nft.connect(recipient).redeem(forgedVoucher, permit),
      ).to.be.revertedWithCustomError(nft, "InvalidSignature");
    });

    it("Should fail if the signature is from a non-owner", async function () {
      const contractAddress = await nft.getAddress();
      const latestTime = await time.latest();
      const nonce = randomUUID();
      const value = {
        recipient: recipient.address,
        uri: "ipfs://QmTest",
        nonce,
        currency: ethers.ZeroAddress,
        basePrice: 0n,
        creatorTip: 0n,
        deadline: latestTime + 3600,
      };
      const signature = await malicious.signTypedData(
        await makeDomain(contractAddress),
        VOUCHER_TYPES,
        value,
      );
      const voucher = { ...value, signature };
      const permit = emptyPermit(value.deadline);

      await expect(
        nft.connect(recipient).redeem(voucher, permit),
      ).to.be.revertedWithCustomError(nft, "InvalidSignature");
    });

    it("Should prevent replay attacks (using the same voucher twice)", async function () {
      const voucher = await createVoucher(recipient.address, "ipfs://QmTest");
      const permit = emptyPermit(voucher.deadline);

      await nft.connect(recipient).redeem(voucher, permit);

      await expect(
        nft.connect(recipient).redeem(voucher, permit),
      ).to.be.revertedWithCustomError(nft, "VoucherAlreadyUsed");
    });

    it("Should allow minting by any caller with a valid voucher", async function () {
      const uri = "ipfs://QmTest";
      const voucher = await createVoucher(recipient.address, uri);
      const permit = emptyPermit(voucher.deadline);

      await expect(nft.connect(malicious).redeem(voucher, permit))
        .to.emit(nft, "NFTMinted")
        .withArgs(recipient.address, 1, uri);

      expect(await nft.ownerOf(1)).to.equal(recipient.address);
    });

    it("Should reject expired voucher", async function () {
      const latestTime = await time.latest();
      const voucher = await createVoucherWithDeadline(
        recipient.address,
        "ipfs://QmA",
        latestTime - 1,
      );
      const permit = emptyPermit(voucher.deadline);
      await expect(
        nft.connect(recipient).redeem(voucher, permit),
      ).to.be.revertedWithCustomError(nft, "VoucherExpired");
    });

    it("Should enforce max mint per wallet", async function () {
      const SmallNFT = await ethers.getContractFactory("NFTCollection");
      const small = await SmallNFT.deploy(
        "Small",
        "SM",
        owner.address,
        owner.address,
        0,
        "ipfs://",
        1000,
        paymentReceiver.address,
        2,
        paymentReceiver.address,
        ethers.ZeroAddress,
      );
      const contractAddr = await small.getAddress();
      const latestTime = await time.latest();
      const permit = emptyPermit(latestTime + 3600);
      const makeV = async (n: string) =>
        makeVoucherFor(
          contractAddr,
          recipient.address,
          ethers.ZeroAddress,
          0n,
          0n,
          n,
        );
      await small.connect(recipient).redeem(await makeV("n1"), permit);
      await small.connect(recipient).redeem(await makeV("n2"), permit);
      await expect(
        small.connect(recipient).redeem(await makeV("n3"), permit),
      ).to.be.revertedWithCustomError(small, "MaxMintPerWalletExceeded");
    });

    it("Should mint with ETH payment and forward basePrice to paymentReceiver", async function () {
      const price = ethers.parseEther("0.1");
      const voucher = await createVoucherWithPrice(
        recipient.address,
        "ipfs://QmEth",
        ethers.ZeroAddress,
        price,
      );
      const permit = emptyPermit(voucher.deadline);

      const before = await ethers.provider.getBalance(paymentReceiver.address);
      await nft.connect(recipient).redeem(voucher, permit, { value: price });
      const after = await ethers.provider.getBalance(paymentReceiver.address);
      expect(after - before).to.equal(price);
    });

    it("Should reject non-exact ETH for paid voucher", async function () {
      const price = ethers.parseEther("0.1");
      const voucher = await createVoucherWithPrice(
        recipient.address,
        "ipfs://QmEth",
        ethers.ZeroAddress,
        price,
      );
      const permit = emptyPermit(voucher.deadline);
      await expect(
        nft
          .connect(recipient)
          .redeem(voucher, permit, { value: ethers.parseEther("0.05") }),
      ).to.be.revertedWithCustomError(nft, "ExactETHRequired");
    });

    it("Should reject ETH sent alongside ERC20 voucher", async function () {
      const token = await deployErc20();
      const price = ethers.parseEther("10");
      const tokenAddr = await token.getAddress();
      await token.transfer(recipient.address, price);
      await token.connect(recipient).approve(await nft.getAddress(), price);
      const voucher = await createVoucherWithPrice(
        recipient.address,
        "ipfs://QmERC",
        tokenAddr,
        price,
      );
      const permit = emptyPermit(voucher.deadline);
      await expect(
        nft
          .connect(recipient)
          .redeem(voucher, permit, { value: ethers.parseEther("0.01") }),
      ).to.be.revertedWithCustomError(nft, "ETHWithERC20Payment");
    });
  });

  // ─── base + tip routing ────────────────────────────────────────────────────

  describe("base + tip routing", function () {
    let tipNft: NFTCollection;

    beforeEach(async function () {
      const NFTContract = await ethers.getContractFactory("NFTCollection");
      tipNft = await NFTContract.deploy(
        "Tip NFT",
        "TNFT2",
        owner.address,
        owner.address,
        0,
        "ipfs://",
        100,
        paymentReceiver.address,
        10,
        tipReceiver.address, // separate tipReceiver
        ethers.ZeroAddress,
      );
      await tipNft.waitForDeployment();
    });

    it("Should split ETH: basePrice → paymentReceiver, creatorTip → tipReceiver", async function () {
      const base = ethers.parseEther("0.1");
      const tip = ethers.parseEther("0.02");
      const contractAddr = await tipNft.getAddress();
      const latestTime = await time.latest();
      const value = {
        recipient: recipient.address,
        uri: "ipfs://split",
        nonce: randomUUID(),
        currency: ethers.ZeroAddress,
        basePrice: base,
        creatorTip: tip,
        deadline: latestTime + 3600,
      };
      const sig = await owner.signTypedData(
        {
          name: SIGNING_DOMAIN_NAME,
          version: SIGNING_DOMAIN_VERSION,
          chainId,
          verifyingContract: contractAddr,
        },
        VOUCHER_TYPES,
        value,
      );
      const voucher = { ...value, signature: sig };
      const permit = emptyPermit(value.deadline);

      const beforePR = await ethers.provider.getBalance(
        paymentReceiver.address,
      );
      const beforeTip = await ethers.provider.getBalance(tipReceiver.address);

      await tipNft
        .connect(recipient)
        .redeem(voucher, permit, { value: base + tip });

      const afterPR = await ethers.provider.getBalance(paymentReceiver.address);
      const afterTip = await ethers.provider.getBalance(tipReceiver.address);

      expect(afterPR - beforePR).to.equal(base);
      expect(afterTip - beforeTip).to.equal(tip);
    });

    it("Should reject if msg.value != basePrice + creatorTip", async function () {
      const base = ethers.parseEther("0.1");
      const tip = ethers.parseEther("0.02");
      const contractAddr = await tipNft.getAddress();
      const latestTime = await time.latest();
      const value = {
        recipient: recipient.address,
        uri: "ipfs://split",
        nonce: randomUUID(),
        currency: ethers.ZeroAddress,
        basePrice: base,
        creatorTip: tip,
        deadline: latestTime + 3600,
      };
      const sig = await owner.signTypedData(
        {
          name: SIGNING_DOMAIN_NAME,
          version: SIGNING_DOMAIN_VERSION,
          chainId,
          verifyingContract: contractAddr,
        },
        VOUCHER_TYPES,
        value,
      );
      const voucher = { ...value, signature: sig };
      const permit = emptyPermit(value.deadline);

      // Only base, missing tip
      await expect(
        tipNft.connect(recipient).redeem(voucher, permit, { value: base }),
      ).to.be.revertedWithCustomError(tipNft, "ExactETHRequired");
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
    const MINT_PRICE = ethers.parseEther("10");

    async function createErc20Voucher(
      recipientAddr: string,
      uri: string,
      currency: string,
      basePrice: bigint,
      nonce: string = randomUUID(),
    ) {
      const contractAddress = await nft.getAddress();
      const latestTime = await time.latest();
      const value = {
        recipient: recipientAddr,
        uri,
        nonce,
        currency,
        basePrice,
        creatorTip: 0n,
        deadline: latestTime + 3600,
      };
      const signature = await owner.signTypedData(
        await makeDomain(contractAddress),
        VOUCHER_TYPES,
        value,
      );
      return { ...value, signature };
    }

    it("Should mint with ETH payment and forward funds", async function () {
      const price = ethers.parseEther("0.2");
      const voucher = await createErc20Voucher(
        recipient.address,
        "ipfs://eth-approval",
        ethers.ZeroAddress,
        price,
      );

      const initialBalance = await ethers.provider.getBalance(
        paymentReceiver.address,
      );

      await expect(
        nft.connect(recipient).redeemWithApproval(voucher, { value: price }),
      )
        .to.emit(nft, "NFTMinted")
        .withArgs(recipient.address, 1, "ipfs://eth-approval");

      const finalBalance = await ethers.provider.getBalance(
        paymentReceiver.address,
      );
      expect(finalBalance - initialBalance).to.equal(price);
    });

    it("Should reject non-exact ETH for redeemWithApproval", async function () {
      const price = ethers.parseEther("0.2");
      const voucher = await createErc20Voucher(
        recipient.address,
        "ipfs://eth-approval",
        ethers.ZeroAddress,
        price,
      );

      await expect(
        nft
          .connect(recipient)
          .redeemWithApproval(voucher, { value: price - 1n }),
      ).to.be.revertedWithCustomError(nft, "ExactETHRequired");
    });

    it("Should mint when recipient calls directly (EOA path)", async function () {
      const token = await deployErc20();
      const nftAddr = await nft.getAddress();
      const uri = "ipfs://erc20-eoa";

      await token.transfer(recipient.address, MINT_PRICE);
      await token.connect(recipient).approve(nftAddr, MINT_PRICE);

      const voucher = await createErc20Voucher(
        recipient.address,
        uri,
        await token.getAddress(),
        MINT_PRICE,
      );

      const receiverBefore = await token.balanceOf(paymentReceiver.address);

      await expect(nft.connect(recipient).redeemWithApproval(voucher))
        .to.emit(nft, "NFTMinted")
        .withArgs(recipient.address, 1, uri);

      expect(await nft.ownerOf(1)).to.equal(recipient.address);
      expect(await token.balanceOf(recipient.address)).to.equal(0n);
      expect(await token.balanceOf(paymentReceiver.address)).to.equal(
        receiverBefore + MINT_PRICE,
      );
    });

    it("Should mint when a third party (bundler) submits on recipient's behalf — 4337 path", async function () {
      // Critical ERC-4337 scenario: smart account approves the NFT contract,
      // then EntryPoint/Bundler relays the call. msg.sender != voucher.recipient,
      // but the pull still must come from voucher.recipient (who granted allowance).
      const token = await deployErc20();
      const nftAddr = await nft.getAddress();
      const uri = "ipfs://erc20-bundler";

      await token.transfer(recipient.address, MINT_PRICE);
      await token.connect(recipient).approve(nftAddr, MINT_PRICE);

      const voucher = await createErc20Voucher(
        recipient.address,
        uri,
        await token.getAddress(),
        MINT_PRICE,
      );
      const receiverBefore = await token.balanceOf(paymentReceiver.address);

      await expect(nft.connect(malicious).redeemWithApproval(voucher))
        .to.emit(nft, "NFTMinted")
        .withArgs(recipient.address, 1, uri);

      expect(await nft.ownerOf(1)).to.equal(recipient.address);
      expect(await token.balanceOf(recipient.address)).to.equal(0n);
      expect(await token.balanceOf(malicious.address)).to.equal(0n);
      expect(await token.balanceOf(paymentReceiver.address)).to.equal(
        receiverBefore + MINT_PRICE,
      );
    });

    it("Should revert when the recipient has not approved the NFT contract", async function () {
      const token = await deployErc20();
      const uri = "ipfs://erc20-no-approval";

      await token.transfer(recipient.address, MINT_PRICE);
      // No approve

      const voucher = await createErc20Voucher(
        recipient.address,
        uri,
        await token.getAddress(),
        MINT_PRICE,
      );

      await expect(
        nft.connect(malicious).redeemWithApproval(voucher),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("Should revert when a malicious caller crafts a voucher for a different recipient who hasn't approved", async function () {
      const token = await deployErc20();
      const uri = "ipfs://erc20-drain-attempt";

      await token.transfer(malicious.address, MINT_PRICE);
      await token
        .connect(malicious)
        .approve(await nft.getAddress(), MINT_PRICE);

      // Voucher names `recipient` (not malicious), but recipient has no allowance
      const voucher = await createErc20Voucher(
        recipient.address,
        uri,
        await token.getAddress(),
        MINT_PRICE,
      );

      await expect(
        nft.connect(malicious).redeemWithApproval(voucher),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });
});
