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

  // EIP-712 Constants
  const SIGNING_DOMAIN_NAME = "NFTCollection";
  const SIGNING_DOMAIN_VERSION = "1";
  let chainId: number;

  beforeEach(async function () {
    [owner, recipient, malicious, paymentReceiver] = await ethers.getSigners();
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
    );
    await nft.waitForDeployment();
  });

  async function createVoucher(
    recipientAddr: string,
    uri: string,
    nonce: string = randomUUID(),
  ) {
    const contractAddress = await nft.getAddress();

    // Domain Data
    const domain = {
      name: SIGNING_DOMAIN_NAME,
      version: SIGNING_DOMAIN_VERSION,
      chainId: chainId,
      verifyingContract: contractAddress,
    };

    // EIP-712 Types for NFTVoucher
    const types = {
      NFTVoucher: [
        { name: "recipient", type: "address" },
        { name: "uri", type: "string" },
        { name: "nonce", type: "string" },
        { name: "currency", type: "address" },
        { name: "minPrice", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    // Data to sign - use blockchain time, not system time
    const latestTime = await time.latest();
    const deadline = latestTime + 3600; // 1 hour from now
    const value = {
      recipient: recipientAddr,
      uri: uri,
      nonce: nonce,
      currency: "0x0000000000000000000000000000000000000000", // ETH
      minPrice: 0n,
      deadline: deadline,
    };

    const signature = await owner.signTypedData(domain, types, value);

    return {
      recipient: recipientAddr,
      uri: uri,
      nonce: nonce,
      currency: "0x0000000000000000000000000000000000000000",
      minPrice: 0n,
      deadline: deadline,
      signature: signature,
    };
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

  async function createVoucherWithDeadline(
    recipientAddr: string,
    uri: string,
    deadline: number,
    nonce: string = randomUUID(),
  ) {
    const contractAddress = await nft.getAddress();
    const domain = {
      name: SIGNING_DOMAIN_NAME,
      version: SIGNING_DOMAIN_VERSION,
      chainId,
      verifyingContract: contractAddress,
    };
    const types = {
      NFTVoucher: [
        { name: "recipient", type: "address" },
        { name: "uri", type: "string" },
        { name: "nonce", type: "string" },
        { name: "currency", type: "address" },
        { name: "minPrice", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const value = {
      recipient: recipientAddr,
      uri,
      nonce,
      currency: ethers.ZeroAddress,
      minPrice: 0n,
      deadline,
    };
    const signature = await owner.signTypedData(domain, types, value);
    return { ...value, signature };
  }

  async function createVoucherWithPrice(
    recipientAddr: string,
    uri: string,
    currency: string,
    price: bigint,
    nonce: string = randomUUID(),
  ) {
    const contractAddress = await nft.getAddress();
    const domain = {
      name: SIGNING_DOMAIN_NAME,
      version: SIGNING_DOMAIN_VERSION,
      chainId,
      verifyingContract: contractAddress,
    };
    const types = {
      NFTVoucher: [
        { name: "recipient", type: "address" },
        { name: "uri", type: "string" },
        { name: "nonce", type: "string" },
        { name: "currency", type: "address" },
        { name: "minPrice", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const latestTime = await time.latest();
    const value = {
      recipient: recipientAddr,
      uri,
      nonce,
      currency,
      minPrice: price,
      deadline: latestTime + 3600,
    };
    const signature = await owner.signTypedData(domain, types, value);
    return { ...value, signature };
  }

  async function deployErc20() {
    const ATTR = await ethers.getContractFactory("ATTRToken");
    const cap = ethers.parseEther("1000000");
    const initialSupply = ethers.parseEther("1000");
    const token = await ATTR.deploy(cap, initialSupply, owner.address);
    await token.waitForDeployment();
    return token;
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
      ).to.be.revertedWith("Cannot mint to zero address");
    });

    it("Should reject mintTo with empty URI", async function () {
      await expect(
        nft.connect(owner).mintTo(recipient.address, ""),
      ).to.be.revertedWith("URI cannot be empty");
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
      );
      await small.mintTo(recipient.address, "ipfs://1");
      await small.mintTo(recipient.address, "ipfs://2");
      await expect(
        small.mintTo(recipient.address, "ipfs://3"),
      ).to.be.revertedWith("Max supply exceeded");
    });

    it("Should track getMintedCount per wallet after mintTo", async function () {
      expect(await nft.getMintedCount(recipient.address)).to.equal(0n);
      await nft.connect(owner).mintTo(recipient.address, "ipfs://QmA");
      // mintTo bypasses per-wallet counter (owner admin mint), getMintedCount is for voucher mints
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
      const uri = "ipfs://QmTest";
      const voucher = await createVoucher(recipient.address, uri);
      const forgedVoucher = { ...voucher, uri: "ipfs://QmHacked" };
      const permit = emptyPermit(voucher.deadline);

      await expect(
        nft.connect(recipient).redeem(forgedVoucher, permit),
      ).to.be.revertedWith("Invalid voucher signature");
    });

    it("Should fail if the signature is from a non-owner", async function () {
      const uri = "ipfs://QmTest";
      // Create a voucher signed by 'malicious' user instead of owner
      const contractAddress = await nft.getAddress();
      const latestTime = await time.latest();
      const deadline = latestTime + 3600;
      const nonce = randomUUID();

      const domain = {
        name: SIGNING_DOMAIN_NAME,
        version: SIGNING_DOMAIN_VERSION,
        chainId: chainId,
        verifyingContract: contractAddress,
      };
      const types = {
        NFTVoucher: [
          { name: "recipient", type: "address" },
          { name: "uri", type: "string" },
          { name: "nonce", type: "string" },
          { name: "currency", type: "address" },
          { name: "minPrice", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        recipient: recipient.address,
        uri,
        nonce,
        currency: "0x0000000000000000000000000000000000000000",
        minPrice: 0n,
        deadline: deadline,
      };

      const signature = await malicious.signTypedData(domain, types, value);
      const voucher = { ...value, signature };

      const permit = emptyPermit(deadline);

      await expect(
        nft.connect(recipient).redeem(voucher, permit),
      ).to.be.revertedWith("Invalid voucher signature");
    });

    it("Should prevent replay attacks (using the same voucher twice)", async function () {
      const uri = "ipfs://QmTest";
      const voucher = await createVoucher(recipient.address, uri);
      const permit = emptyPermit(voucher.deadline);

      // First mint should succeed
      await nft.connect(recipient).redeem(voucher, permit);

      // Second mint with same voucher should fail
      await expect(
        nft.connect(recipient).redeem(voucher, permit),
      ).to.be.revertedWith("Nonce already used");
    });

    it("Should allow minting by any caller if they hold a valid voucher", async function () {
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
      ).to.be.revertedWith("Voucher expired");
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
      );
      const contractAddr = await small.getAddress();
      const domain = {
        name: "NFTCollection",
        version: "1",
        chainId,
        verifyingContract: contractAddr,
      };
      const types = {
        NFTVoucher: [
          { name: "recipient", type: "address" },
          { name: "uri", type: "string" },
          { name: "nonce", type: "string" },
          { name: "currency", type: "address" },
          { name: "minPrice", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const latestTime = await time.latest();
      const makeV = async (n: string) => {
        const v = {
          recipient: recipient.address,
          uri: "ipfs://x",
          nonce: n,
          currency: ethers.ZeroAddress,
          minPrice: 0n,
          deadline: latestTime + 3600,
        };
        return { ...v, signature: await owner.signTypedData(domain, types, v) };
      };
      const permit = emptyPermit(latestTime + 3600);
      await small.connect(recipient).redeem(await makeV("n1"), permit);
      await small.connect(recipient).redeem(await makeV("n2"), permit);
      await expect(
        small.connect(recipient).redeem(await makeV("n3"), permit),
      ).to.be.revertedWith("Max mint per wallet exceeded");
    });

    it("Should mint with ETH payment and forward to paymentReceiver", async function () {
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

    it("Should reject insufficient ETH for paid voucher", async function () {
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
      ).to.be.revertedWith("Insufficient ETH sent");
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
      ).to.be.revertedWith("ETH sent with ERC20 payment");
    });
  });

  // Regression tests for ERC-4337 smart-account compatibility.
  //
  // `redeemWithApproval` deliberately pulls ERC20 payment from `voucher.recipient`
  // (NOT `msg.sender`) so that smart-account flows using `wallet_sendCalls` —
  // where msg.sender is the EntryPoint/Bundler, not the user — can still mint.
  //
  // See: frontend/docs/CONTRACT_FIX_NEEDED.md. These tests lock in that
  // behavior so anyone who "helpfully" changes it to msg.sender will fail CI.
  describe("redeemWithApproval (ERC20 + 4337)", function () {
    const MINT_PRICE = ethers.parseEther("10"); // 10 ATTR

    async function createErc20Voucher(
      recipientAddr: string,
      uri: string,
      currency: string,
      price: bigint,
      nonce: string = randomUUID(),
    ) {
      const contractAddress = await nft.getAddress();
      const domain = {
        name: SIGNING_DOMAIN_NAME,
        version: SIGNING_DOMAIN_VERSION,
        chainId,
        verifyingContract: contractAddress,
      };
      const types = {
        NFTVoucher: [
          { name: "recipient", type: "address" },
          { name: "uri", type: "string" },
          { name: "nonce", type: "string" },
          { name: "currency", type: "address" },
          { name: "minPrice", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const latestTime = await time.latest();
      const deadline = latestTime + 3600;
      const value = {
        recipient: recipientAddr,
        uri,
        nonce,
        currency,
        minPrice: price,
        deadline,
      };
      const signature = await owner.signTypedData(domain, types, value);
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

    it("Should reject insufficient ETH for redeemWithApproval", async function () {
      const price = ethers.parseEther("0.2");
      const voucher = await createErc20Voucher(
        recipient.address,
        "ipfs://eth-approval",
        ethers.ZeroAddress,
        price,
      );

      await expect(
        nft.connect(recipient).redeemWithApproval(voucher, { value: price - 1n }),
      ).to.be.revertedWith("Insufficient ETH sent");
    });

    it("Should mint when recipient calls directly (EOA path)", async function () {
      const token = await deployErc20();
      const nftAddr = await nft.getAddress();
      const uri = "ipfs://erc20-eoa";

      // Fund recipient with ATTR and approve the NFT contract.
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
      // This is the critical ERC-4337 scenario: the smart account approves
      // the NFT contract, then the EntryPoint / Bundler relays the call. In
      // that world msg.sender != voucher.recipient, but the pull still has
      // to come from voucher.recipient (who granted the allowance).
      const token = await deployErc20();
      const nftAddr = await nft.getAddress();
      const uri = "ipfs://erc20-bundler";

      // Fund the RECIPIENT (simulating the smart account), and the RECIPIENT
      // approves the NFT contract. The `malicious` signer here plays the
      // role of the bundler / EntryPoint — it has no allowance and no ATTR.
      await token.transfer(recipient.address, MINT_PRICE);
      await token.connect(recipient).approve(nftAddr, MINT_PRICE);

      const voucher = await createErc20Voucher(
        recipient.address,
        uri,
        await token.getAddress(),
        MINT_PRICE,
      );

      const receiverBefore = await token.balanceOf(paymentReceiver.address);

      // Bundler submits, NOT the recipient.
      await expect(nft.connect(malicious).redeemWithApproval(voucher))
        .to.emit(nft, "NFTMinted")
        .withArgs(recipient.address, 1, uri);

      // NFT goes to the voucher recipient, not the caller.
      expect(await nft.ownerOf(1)).to.equal(recipient.address);
      // Payment was pulled from the recipient (who approved), not the bundler.
      expect(await token.balanceOf(recipient.address)).to.equal(0n);
      expect(await token.balanceOf(malicious.address)).to.equal(0n);
      expect(await token.balanceOf(paymentReceiver.address)).to.equal(
        receiverBefore + MINT_PRICE,
      );
    });

    it("Should revert when the recipient has not approved the NFT contract", async function () {
      const token = await deployErc20();
      const uri = "ipfs://erc20-no-approval";

      // Fund the recipient, but DO NOT approve.
      await token.transfer(recipient.address, MINT_PRICE);

      const voucher = await createErc20Voucher(
        recipient.address,
        uri,
        await token.getAddress(),
        MINT_PRICE,
      );

      // Regardless of who submits, no allowance == revert.
      await expect(
        nft.connect(malicious).redeemWithApproval(voucher),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("Should revert when a malicious caller crafts a voucher for a different recipient who hasn't approved", async function () {
      // Guards against the attack: "can the bundler forge which wallet pays?"
      // The answer is no — the voucher is owner-signed and binds the payer to
      // a specific recipient. A recipient who never approved cannot be drained.
      const token = await deployErc20();
      const uri = "ipfs://erc20-drain-attempt";

      // The `malicious` caller has tokens and has approved the NFT contract
      // for ITS OWN account, but the voucher names `recipient`. Since the
      // contract pulls from voucher.recipient (not msg.sender), this should
      // fail: recipient has no allowance.
      await token.transfer(malicious.address, MINT_PRICE);
      await token
        .connect(malicious)
        .approve(await nft.getAddress(), MINT_PRICE);

      const voucher = await createErc20Voucher(
        recipient.address, // voucher names recipient, not malicious
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
