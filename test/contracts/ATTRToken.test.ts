import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress, hexToSignature, getAddress } from "viem";

const { viem, networkHelpers } = await hre.network.create();

describe("ATTRToken", function () {
  let token: Awaited<ReturnType<typeof viem.deployContract<"ATTRToken">>>;
  let owner: Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  let treasury: typeof owner;
  let minter: typeof owner;
  let user1: typeof owner;
  let user2: typeof owner;
  let publicClient: Awaited<ReturnType<typeof viem.getPublicClient>>;

  const CAP = parseEther("1000000000"); // 1 billion tokens
  const INITIAL_SUPPLY = parseEther("100000000"); // 100 million tokens

  beforeEach(async function () {
    [owner, treasury, minter, user1, user2] = await viem.getWalletClients();
    publicClient = await viem.getPublicClient();

    token = await viem.deployContract("ATTRToken", [
      CAP,
      INITIAL_SUPPLY,
      treasury.account.address,
    ]);
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await token.read.name()).to.equal("Attribute Point");
      expect(await token.read.symbol()).to.equal("ATTR");
    });

    it("Should set the correct cap", async function () {
      expect(await token.read.cap()).to.equal(CAP);
    });

    it("Should mint initial supply to treasury", async function () {
      expect(await token.read.balanceOf([treasury.account.address])).to.equal(
        INITIAL_SUPPLY,
      );
    });

    it("Should grant admin and minter roles to deployer", async function () {
      const DEFAULT_ADMIN_ROLE = await token.read.DEFAULT_ADMIN_ROLE();
      const MINTER_ROLE = await token.read.MINTER_ROLE();

      expect(
        await token.read.hasRole([DEFAULT_ADMIN_ROLE, owner.account.address]),
      ).to.be.true;
      expect(await token.read.hasRole([MINTER_ROLE, owner.account.address])).to
        .be.true;
    });

    it("Should revert if treasury is zero address", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("ATTRToken", [CAP, INITIAL_SUPPLY, zeroAddress]),
        token,
        "ZeroAddress",
      );
    });

    it("Should revert if cap is zero", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("ATTRToken", [0n, 0n, treasury.account.address]),
        token,
        "ERC20InvalidCap",
      );
    });

    it("Should revert if initial supply exceeds cap", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("ATTRToken", [
          CAP,
          CAP + 1n,
          treasury.account.address,
        ]),
        token,
        "MaxSupplyExceeded",
      );
    });

    it("Should allow zero initial supply", async function () {
      const zeroSupplyToken = await viem.deployContract("ATTRToken", [
        CAP,
        0n,
        treasury.account.address,
      ]);

      expect(await zeroSupplyToken.read.totalSupply()).to.equal(0n);
      expect(
        await zeroSupplyToken.read.balanceOf([treasury.account.address]),
      ).to.equal(0n);
    });
  });

  describe("Minting", function () {
    it("Should allow minter to mint tokens", async function () {
      await token.write.mint([user1.account.address, parseEther("1000")]);
      expect(await token.read.balanceOf([user1.account.address])).to.equal(
        parseEther("1000"),
      );
    });

    it("Should not allow minting beyond cap", async function () {
      const remainingSupply = CAP - INITIAL_SUPPLY;
      await viem.assertions.revertWithCustomError(
        token.write.mint([user1.account.address, remainingSupply + 1n]),
        token,
        "ERC20ExceededCap",
      );
    });

    it("Should not allow non-minter to mint", async function () {
      await viem.assertions.revertWithCustomError(
        token.write.mint([user2.account.address, parseEther("1000")], {
          account: user1.account,
        }),
        token,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("Should allow granting minter role", async function () {
      const MINTER_ROLE = await token.read.MINTER_ROLE();
      await token.write.grantRole([MINTER_ROLE, minter.account.address]);

      await token.write.mint([user1.account.address, parseEther("500")], {
        account: minter.account,
      });
      expect(await token.read.balanceOf([user1.account.address])).to.equal(
        parseEther("500"),
      );
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      await token.write.transfer([user1.account.address, parseEther("10000")], {
        account: treasury.account,
      });
    });

    it("Should allow users to burn their tokens", async function () {
      const burnAmount = parseEther("1000");
      await token.write.burn([burnAmount], { account: user1.account });

      expect(await token.read.balanceOf([user1.account.address])).to.equal(
        parseEther("9000"),
      );
    });

    it("Should decrease total supply when burning", async function () {
      const initialSupply = await token.read.totalSupply();
      const burnAmount = parseEther("1000");

      await token.write.burn([burnAmount], { account: user1.account });

      expect(await token.read.totalSupply()).to.equal(
        initialSupply - burnAmount,
      );
    });
  });

  describe("ERC20Permit", function () {
    it("Should allow gasless approvals with permit", async function () {
      const value = parseEther("100");
      const deadline = BigInt((await networkHelpers.time.latest()) + 3600);
      const nonce = await token.read.nonces([treasury.account.address]);
      const chainId = await publicClient.getChainId();

      const signature = await treasury.signTypedData({
        domain: {
          name: "Attribute Point",
          version: "1",
          chainId,
          verifyingContract: token.address,
        },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: {
          owner: treasury.account.address,
          spender: user1.account.address,
          value,
          nonce,
          deadline,
        },
      });

      const { v, r, s } = hexToSignature(signature);

      await token.write.permit([
        treasury.account.address,
        user1.account.address,
        value,
        deadline,
        Number(v),
        r,
        s,
      ]);

      expect(
        await token.read.allowance([
          treasury.account.address,
          user1.account.address,
        ]),
      ).to.equal(value);
    });
  });

  describe("Governance (ERC20Votes)", function () {
    beforeEach(async function () {
      await token.write.transfer([user1.account.address, parseEther("10000")], {
        account: treasury.account,
      });
    });

    it("Should track votes after delegation", async function () {
      await token.write.delegate([user1.account.address], {
        account: user1.account,
      });

      expect(await token.read.getVotes([user1.account.address])).to.equal(
        parseEther("10000"),
      );
    });

    it("Should update votes on transfer", async function () {
      await token.write.delegate([user1.account.address], {
        account: user1.account,
      });

      await token.write.transfer([user2.account.address, parseEther("3000")], {
        account: user1.account,
      });

      expect(await token.read.getVotes([user1.account.address])).to.equal(
        parseEther("7000"),
      );
    });

    it("Should allow delegation to another address", async function () {
      await token.write.delegate([user2.account.address], {
        account: user1.account,
      });

      expect(await token.read.getVotes([user2.account.address])).to.equal(
        parseEther("10000"),
      );
      expect(await token.read.getVotes([user1.account.address])).to.equal(0n);
    });
  });

  describe("Access Control", function () {
    it("Should allow admin to grant roles", async function () {
      const MINTER_ROLE = await token.read.MINTER_ROLE();
      await token.write.grantRole([MINTER_ROLE, minter.account.address]);

      expect(await token.read.hasRole([MINTER_ROLE, minter.account.address])).to
        .be.true;
    });

    it("Should allow admin to revoke roles", async function () {
      const MINTER_ROLE = await token.read.MINTER_ROLE();
      await token.write.grantRole([MINTER_ROLE, minter.account.address]);
      await token.write.revokeRole([MINTER_ROLE, minter.account.address]);

      expect(await token.read.hasRole([MINTER_ROLE, minter.account.address])).to
        .be.false;
    });

    it("Should not allow non-admin to grant roles", async function () {
      const MINTER_ROLE = await token.read.MINTER_ROLE();
      await viem.assertions.revertWithCustomError(
        token.write.grantRole([MINTER_ROLE, user2.account.address], {
          account: user1.account,
        }),
        token,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("Pause / Unpause", function () {
    it("Should allow admin to pause and unpause minting", async function () {
      await viem.assertions.emitWithArgs(token.write.pause(), token, "Paused", [
        getAddress(owner.account.address),
      ]);

      await viem.assertions.revertWithCustomError(
        token.write.mint([user1.account.address, parseEther("1")]),
        token,
        "EnforcedPause",
      );

      await viem.assertions.emitWithArgs(
        token.write.unpause(),
        token,
        "Unpaused",
        [getAddress(owner.account.address)],
      );

      await token.write.mint([user1.account.address, parseEther("1")]);

      expect(await token.read.balanceOf([user1.account.address])).to.equal(
        parseEther("1"),
      );
    });

    it("Should not allow non-admin to pause or unpause", async function () {
      await viem.assertions.revertWithCustomError(
        token.write.pause({ account: user1.account }),
        token,
        "AccessControlUnauthorizedAccount",
      );

      await token.write.pause();

      await viem.assertions.revertWithCustomError(
        token.write.unpause({ account: user1.account }),
        token,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("Gas Optimization", function () {
    it("Should use reasonable gas for transfers", async function () {
      await token.write.transfer([user1.account.address, parseEther("1000")], {
        account: treasury.account,
      });

      const hash = await token.write.transfer(
        [user2.account.address, parseEther("100")],
        { account: user1.account },
      );
      const receipt = await publicClient.getTransactionReceipt({ hash });

      expect(receipt.gasUsed).to.be.lessThan(100000n);
    });
  });
});
