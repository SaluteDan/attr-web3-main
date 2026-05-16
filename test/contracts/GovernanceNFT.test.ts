import { expect } from "chai";
import { ethers } from "hardhat";
import { GovernanceNFT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { randomUUID } from "crypto";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("GovernanceNFT", function () {
  let nft: GovernanceNFT;
  let owner: SignerWithAddress;
  let paymentReceiver: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const MAX_SUPPLY = 10000n;
  const MAX_MINT_PER_WALLET = 5n;
  const ROYALTY_FEE = 500n; // 5%

  beforeEach(async function () {
    [owner, paymentReceiver, user1, user2] = await ethers.getSigners();

    const NFTContract = await ethers.getContractFactory("GovernanceNFT");
    nft = await NFTContract.deploy(
      "Governance Pass",
      "GPASS",
      owner.address,
      paymentReceiver.address,
      ROYALTY_FEE,
      "ipfs://QmCollection",
      MAX_SUPPLY,
      paymentReceiver.address,
      MAX_MINT_PER_WALLET,
    );
    await nft.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set correct name and symbol", async function () {
      expect(await nft.name()).to.equal("Governance Pass");
      expect(await nft.symbol()).to.equal("GPASS");
    });

    it("Should set correct owner", async function () {
      expect(await nft.owner()).to.equal(owner.address);
    });

    it("Should set correct max supply", async function () {
      expect(await nft.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
    });

    it("Should set correct max mint per wallet", async function () {
      expect(await nft.MAX_MINT_PER_WALLET()).to.equal(MAX_MINT_PER_WALLET);
    });

    it("Should set contract URI", async function () {
      expect(await nft.contractURI()).to.equal("ipfs://QmCollection");
    });
  });

  describe("Owner Minting", function () {
    it("Should allow owner to mint", async function () {
      await expect(nft.mintTo(user1.address, "ipfs://token1"))
        .to.emit(nft, "NFTMinted")
        .withArgs(user1.address, 1, "ipfs://token1");

      expect(await nft.ownerOf(1)).to.equal(user1.address);
      expect(await nft.tokenURI(1)).to.equal("ipfs://token1");
    });

    it("Should not allow non-owner to mint", async function () {
      await expect(
        nft.connect(user1).mintTo(user2.address, "ipfs://token1"),
      ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });

    it("Should enforce max supply", async function () {
      const nftSmall = await (
        await ethers.getContractFactory("GovernanceNFT")
      ).deploy(
        "Small",
        "SML",
        owner.address,
        paymentReceiver.address,
        ROYALTY_FEE,
        "ipfs://QmCollection",
        2n, // Max supply of 2
        paymentReceiver.address,
        10n,
      );

      await nftSmall.mintTo(user1.address, "ipfs://token1");
      await nftSmall.mintTo(user1.address, "ipfs://token2");

      await expect(
        nftSmall.mintTo(user1.address, "ipfs://token3"),
      ).to.be.revertedWith("Max supply exceeded");
    });

    it("Should not mint to zero address", async function () {
      await expect(
        nft.mintTo(ethers.ZeroAddress, "ipfs://token1"),
      ).to.be.revertedWith("Zero address");
    });

    it("Should not mint with empty URI", async function () {
      await expect(nft.mintTo(user1.address, "")).to.be.revertedWith(
        "Empty URI",
      );
    });
  });

  describe("Voucher Minting", function () {
    async function createVoucher(
      recipient: string,
      uri: string,
      currency: string = ethers.ZeroAddress,
      minPrice: bigint = 0n,
      nonce: string = randomUUID(),
    ) {
      const deadline = (await time.latest()) + 3600;
      const domain = {
        name: "Governance Pass",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await nft.getAddress(),
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
        recipient,
        uri,
        nonce,
        currency,
        minPrice,
        deadline,
      };

      const signature = await owner.signTypedData(domain, types, value);

      return { ...value, signature };
    }

    it("Should mint with valid free voucher", async function () {
      const voucher = await createVoucher(user1.address, "ipfs://token1");

      await expect(nft.connect(user1).mintWithVoucher(voucher))
        .to.emit(nft, "NFTMinted")
        .withArgs(user1.address, 1, "ipfs://token1");

      expect(await nft.ownerOf(1)).to.equal(user1.address);
    });

    it("Should mint with ETH payment", async function () {
      const price = ethers.parseEther("0.1");
      const voucher = await createVoucher(
        user1.address,
        "ipfs://token1",
        ethers.ZeroAddress,
        price,
      );

      const initialBalance = await ethers.provider.getBalance(
        paymentReceiver.address,
      );

      await nft.connect(user1).mintWithVoucher(voucher, { value: price });

      const finalBalance = await ethers.provider.getBalance(
        paymentReceiver.address,
      );
      expect(finalBalance - initialBalance).to.equal(price);
    });

    it("Should reject insufficient ETH payment", async function () {
      const price = ethers.parseEther("0.1");
      const voucher = await createVoucher(
        user1.address,
        "ipfs://token1",
        ethers.ZeroAddress,
        price,
      );

      await expect(
        nft
          .connect(user1)
          .mintWithVoucher(voucher, { value: ethers.parseEther("0.05") }),
      ).to.be.revertedWith("Insufficient ETH");
    });

    it("Should mint with ERC20 payment", async function () {
      const TokenContract = await ethers.getContractFactory("ATTRToken");
      const token = await TokenContract.deploy(
        ethers.parseEther("1000000"),
        ethers.parseEther("1000"),
        owner.address,
      );
      await token.waitForDeployment();

      const price = ethers.parseEther("25");
      await token.transfer(user1.address, price);
      await token.connect(user1).approve(await nft.getAddress(), price);

      const voucher = await createVoucher(
        user1.address,
        "ipfs://erc20",
        await token.getAddress(),
        price,
      );

      await expect(nft.connect(user1).mintWithVoucher(voucher))
        .to.emit(nft, "NFTMinted")
        .withArgs(user1.address, 1, "ipfs://erc20");

      expect(await token.balanceOf(paymentReceiver.address)).to.equal(price);
    });

    it("Should reject ETH sent alongside ERC20 voucher", async function () {
      const TokenContract = await ethers.getContractFactory("ATTRToken");
      const token = await TokenContract.deploy(
        ethers.parseEther("1000000"),
        ethers.parseEther("1000"),
        owner.address,
      );
      await token.waitForDeployment();

      const voucher = await createVoucher(
        user1.address,
        "ipfs://erc20",
        await token.getAddress(),
        ethers.parseEther("1"),
      );

      await expect(
        nft.connect(user1).mintWithVoucher(voucher, { value: 1 }),
      ).to.be.revertedWith("ETH sent with ERC20");
    });

    it("Should prevent replay attacks", async function () {
      const voucher = await createVoucher(user1.address, "ipfs://token1");

      await nft.connect(user1).mintWithVoucher(voucher);

      await expect(
        nft.connect(user1).mintWithVoucher(voucher),
      ).to.be.revertedWithCustomError(nft, "VoucherAlreadyUsed");
    });

    it("Should reject expired voucher", async function () {
      const voucher = await createVoucher(user1.address, "ipfs://token1");

      await time.increase(3601); // Move past deadline

      await expect(
        nft.connect(user1).mintWithVoucher(voucher),
      ).to.be.revertedWith("Voucher expired");
    });

    it("Should reject invalid signature", async function () {
      const voucher = await createVoucher(user1.address, "ipfs://token1");
      const tamperedVoucher = { ...voucher, uri: "ipfs://hacked" };

      await expect(
        nft.connect(user1).mintWithVoucher(tamperedVoucher),
      ).to.be.revertedWithCustomError(nft, "InvalidSignature");
    });

    it("Should enforce max mint per wallet", async function () {
      for (let i = 0; i < Number(MAX_MINT_PER_WALLET); i++) {
        const voucher = await createVoucher(user1.address, `ipfs://token${i}`);
        await nft.connect(user1).mintWithVoucher(voucher);
      }

      const extraVoucher = await createVoucher(user1.address, "ipfs://extra");
      await expect(
        nft.connect(user1).mintWithVoucher(extraVoucher),
      ).to.be.revertedWith("Max mint per wallet exceeded");
    });
  });

  describe("Governance (ERC721Votes)", function () {
    beforeEach(async function () {
      await nft.mintTo(user1.address, "ipfs://token1");
      await nft.mintTo(user1.address, "ipfs://token2");
    });

    it("Should track votes after delegation", async function () {
      await nft.connect(user1).delegate(user1.address);

      expect(await nft.getVotes(user1.address)).to.equal(2);
    });

    it("Should allow delegation to another address", async function () {
      await nft.connect(user1).delegate(user2.address);

      expect(await nft.getVotes(user2.address)).to.equal(2);
      expect(await nft.getVotes(user1.address)).to.equal(0);
    });

    it("Should update votes on transfer", async function () {
      await nft.connect(user1).delegate(user1.address);

      await nft.connect(user1).transferFrom(user1.address, user2.address, 1);

      expect(await nft.getVotes(user1.address)).to.equal(1);
    });
  });

  describe("Royalties (ERC2981)", function () {
    it("Should return correct royalty info", async function () {
      await nft.mintTo(user1.address, "ipfs://token1");

      const salePrice = ethers.parseEther("1");
      const [receiver, royaltyAmount] = await nft.royaltyInfo(1, salePrice);

      expect(receiver).to.equal(paymentReceiver.address);
      expect(royaltyAmount).to.equal((salePrice * ROYALTY_FEE) / 10000n);
    });
  });

  describe("Token URI Management", function () {
    it("Should allow owner to update token URI", async function () {
      await nft.mintTo(user1.address, "ipfs://token1");

      await nft.setTokenURI(1, "ipfs://updated");

      expect(await nft.tokenURI(1)).to.equal("ipfs://updated");
    });

    it("Should not allow non-owner to update token URI", async function () {
      await nft.mintTo(user1.address, "ipfs://token1");

      await expect(
        nft.connect(user1).setTokenURI(1, "ipfs://hacked"),
      ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });
  });

  describe("Total Supply", function () {
    it("Should track total supply correctly", async function () {
      expect(await nft.totalSupply()).to.equal(0);

      await nft.mintTo(user1.address, "ipfs://token1");
      expect(await nft.totalSupply()).to.equal(1);

      await nft.mintTo(user2.address, "ipfs://token2");
      expect(await nft.totalSupply()).to.equal(2);
    });
  });

  describe("Pause / Unpause", function () {
    it("Should allow owner to pause and unpause minting", async function () {
      await expect(nft.pause()).to.emit(nft, "Paused").withArgs(owner.address);
      await expect(nft.mintTo(user1.address, "ipfs://paused")).to.be.revertedWithCustomError(
        nft,
        "EnforcedPause",
      );

      await expect(nft.unpause()).to.emit(nft, "Unpaused").withArgs(owner.address);
      await nft.mintTo(user1.address, "ipfs://active");

      expect(await nft.ownerOf(1)).to.equal(user1.address);
    });

    it("Should not allow non-owner to pause or unpause", async function () {
      await expect(nft.connect(user1).pause()).to.be.revertedWithCustomError(
        nft,
        "OwnableUnauthorizedAccount",
      );

      await nft.pause();

      await expect(nft.connect(user1).unpause()).to.be.revertedWithCustomError(
        nft,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});
