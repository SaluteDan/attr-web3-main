import { expect } from "chai";
import { ethers } from "hardhat";
import { ATTRToken } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ATTRToken", function () {
  let token: ATTRToken;
  let owner: SignerWithAddress;
  let treasury: SignerWithAddress;
  let minter: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const CAP = ethers.parseEther("1000000000"); // 1 billion tokens
  const INITIAL_SUPPLY = ethers.parseEther("100000000"); // 100 million tokens

  beforeEach(async function () {
    [owner, treasury, minter, user1, user2] = await ethers.getSigners();

    const TokenContract = await ethers.getContractFactory("ATTRToken");
    token = await TokenContract.deploy(CAP, INITIAL_SUPPLY, treasury.address);
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await token.name()).to.equal("Attribute Point");
      expect(await token.symbol()).to.equal("ATTR");
    });

    it("Should set the correct cap", async function () {
      expect(await token.cap()).to.equal(CAP);
    });

    it("Should mint initial supply to treasury", async function () {
      expect(await token.balanceOf(treasury.address)).to.equal(INITIAL_SUPPLY);
    });

    it("Should grant admin and minter roles to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();
      const MINTER_ROLE = await token.MINTER_ROLE();

      expect(await token.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await token.hasRole(MINTER_ROLE, owner.address)).to.be.true;
    });

    it("Should revert if treasury is zero address", async function () {
      const TokenContract = await ethers.getContractFactory("ATTRToken");
      await expect(
        TokenContract.deploy(CAP, INITIAL_SUPPLY, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(token, "ZeroAddress");
    });

    it("Should revert if cap is zero", async function () {
      const TokenContract = await ethers.getContractFactory("ATTRToken");
      await expect(
        TokenContract.deploy(0, 0, treasury.address),
      ).to.be.revertedWithCustomError(token, "ERC20InvalidCap");
    });

    it("Should revert if initial supply exceeds cap", async function () {
      const TokenContract = await ethers.getContractFactory("ATTRToken");
      await expect(
        TokenContract.deploy(CAP, CAP + 1n, treasury.address),
      ).to.be.revertedWithCustomError(token, "MaxSupplyExceeded");
    });

    it("Should allow zero initial supply", async function () {
      const TokenContract = await ethers.getContractFactory("ATTRToken");
      const zeroSupplyToken = await TokenContract.deploy(
        CAP,
        0,
        treasury.address,
      );
      await zeroSupplyToken.waitForDeployment();

      expect(await zeroSupplyToken.totalSupply()).to.equal(0n);
      expect(await zeroSupplyToken.balanceOf(treasury.address)).to.equal(0n);
    });
  });

  describe("Minting", function () {
    it("Should allow minter to mint tokens", async function () {
      await token.mint(user1.address, ethers.parseEther("1000"));
      expect(await token.balanceOf(user1.address)).to.equal(
        ethers.parseEther("1000"),
      );
    });

    it("Should not allow minting beyond cap", async function () {
      const remainingSupply = CAP - INITIAL_SUPPLY;
      await expect(
        token.mint(user1.address, remainingSupply + 1n),
      ).to.be.revertedWithCustomError(token, "ERC20ExceededCap");
    });

    it("Should not allow non-minter to mint", async function () {
      await expect(
        token.connect(user1).mint(user2.address, ethers.parseEther("1000")),
      ).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("Should allow granting minter role", async function () {
      const MINTER_ROLE = await token.MINTER_ROLE();
      await token.grantRole(MINTER_ROLE, minter.address);

      await token.connect(minter).mint(user1.address, ethers.parseEther("500"));
      expect(await token.balanceOf(user1.address)).to.equal(
        ethers.parseEther("500"),
      );
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      await token
        .connect(treasury)
        .transfer(user1.address, ethers.parseEther("10000"));
    });

    it("Should allow users to burn their tokens", async function () {
      const burnAmount = ethers.parseEther("1000");
      await token.connect(user1).burn(burnAmount);

      expect(await token.balanceOf(user1.address)).to.equal(
        ethers.parseEther("9000"),
      );
    });

    it("Should decrease total supply when burning", async function () {
      const initialSupply = await token.totalSupply();
      const burnAmount = ethers.parseEther("1000");

      await token.connect(user1).burn(burnAmount);

      expect(await token.totalSupply()).to.equal(initialSupply - burnAmount);
    });
  });

  describe("ERC20Permit", function () {
    it("Should allow gasless approvals with permit", async function () {
      const value = ethers.parseEther("100");
      const deadline = (await time.latest()) + 3600;
      const nonce = await token.nonces(treasury.address);

      const domain = {
        name: "Attribute Point",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await token.getAddress(),
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const message = {
        owner: treasury.address,
        spender: user1.address,
        value: value,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await treasury.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(signature);

      await token.permit(
        treasury.address,
        user1.address,
        value,
        deadline,
        v,
        r,
        s,
      );

      expect(await token.allowance(treasury.address, user1.address)).to.equal(
        value,
      );
    });
  });

  describe("Governance (ERC20Votes)", function () {
    beforeEach(async function () {
      await token
        .connect(treasury)
        .transfer(user1.address, ethers.parseEther("10000"));
    });

    it("Should track votes after delegation", async function () {
      await token.connect(user1).delegate(user1.address);

      expect(await token.getVotes(user1.address)).to.equal(
        ethers.parseEther("10000"),
      );
    });

    it("Should update votes on transfer", async function () {
      await token.connect(user1).delegate(user1.address);

      await token
        .connect(user1)
        .transfer(user2.address, ethers.parseEther("3000"));

      expect(await token.getVotes(user1.address)).to.equal(
        ethers.parseEther("7000"),
      );
    });

    it("Should allow delegation to another address", async function () {
      await token.connect(user1).delegate(user2.address);

      expect(await token.getVotes(user2.address)).to.equal(
        ethers.parseEther("10000"),
      );
      expect(await token.getVotes(user1.address)).to.equal(0);
    });
  });

  describe("Access Control", function () {
    it("Should allow admin to grant roles", async function () {
      const MINTER_ROLE = await token.MINTER_ROLE();
      await token.grantRole(MINTER_ROLE, minter.address);

      expect(await token.hasRole(MINTER_ROLE, minter.address)).to.be.true;
    });

    it("Should allow admin to revoke roles", async function () {
      const MINTER_ROLE = await token.MINTER_ROLE();
      await token.grantRole(MINTER_ROLE, minter.address);
      await token.revokeRole(MINTER_ROLE, minter.address);

      expect(await token.hasRole(MINTER_ROLE, minter.address)).to.be.false;
    });

    it("Should not allow non-admin to grant roles", async function () {
      const MINTER_ROLE = await token.MINTER_ROLE();
      await expect(
        token.connect(user1).grantRole(MINTER_ROLE, user2.address),
      ).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("Pause / Unpause", function () {
    it("Should allow admin to pause and unpause minting", async function () {
      await expect(token.pause())
        .to.emit(token, "Paused")
        .withArgs(owner.address);

      await expect(
        token.mint(user1.address, ethers.parseEther("1")),
      ).to.be.revertedWithCustomError(token, "EnforcedPause");

      await expect(token.unpause())
        .to.emit(token, "Unpaused")
        .withArgs(owner.address);
      await token.mint(user1.address, ethers.parseEther("1"));

      expect(await token.balanceOf(user1.address)).to.equal(
        ethers.parseEther("1"),
      );
    });

    it("Should not allow non-admin to pause or unpause", async function () {
      await expect(token.connect(user1).pause()).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );

      await token.pause();

      await expect(
        token.connect(user1).unpause(),
      ).to.be.revertedWithCustomError(
        token,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("Gas Optimization", function () {
    it("Should use reasonable gas for transfers", async function () {
      await token
        .connect(treasury)
        .transfer(user1.address, ethers.parseEther("1000"));

      const tx = await token
        .connect(user1)
        .transfer(user2.address, ethers.parseEther("100"));
      const receipt = await tx.wait();

      expect(receipt?.gasUsed).to.be.lessThan(100000n);
    });
  });
});
