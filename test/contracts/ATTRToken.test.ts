import { describe, it, beforeEach } from "node:test";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther, zeroAddress, hexToSignature } from "viem";

const { viem, networkHelpers } = await hre.network.create();

describe("ATTRToken", function () {
  let token: Awaited<ReturnType<typeof viem.deployContract<"ATTRToken">>>;
  let owner: Awaited<ReturnType<typeof viem.getWalletClients>>[number];
  let treasury: typeof owner;
  let user1: typeof owner;
  let user2: typeof owner;
  let publicClient: Awaited<ReturnType<typeof viem.getPublicClient>>;

  // Fixed, immutable cap: the entire supply is minted to the distribution address at deploy.
  const CAP = parseEther("1000000000"); // 1 billion tokens

  beforeEach(async function () {
    [owner, treasury, user1, user2] = await viem.getWalletClients();
    publicClient = await viem.getPublicClient();

    token = await viem.deployContract("ATTRToken", [treasury.account.address]);
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await token.read.name()).to.equal("Attribute Point");
      expect(await token.read.symbol()).to.equal("ATTR");
    });

    it("Should set the fixed 1B cap", async function () {
      expect(await token.read.cap()).to.equal(CAP);
      expect(await token.read.CAP()).to.equal(CAP);
    });

    it("Should mint the entire cap to the distribution address", async function () {
      expect(await token.read.balanceOf([treasury.account.address])).to.equal(
        CAP,
      );
      expect(await token.read.totalSupply()).to.equal(CAP);
    });

    it("Should expose no mint / MINTER_ROLE / pause surface", async function () {
      const abi = token.abi as readonly { type: string; name?: string }[];
      const entries = abi.map((e) => `${e.type}:${e.name ?? ""}`);
      expect(entries).to.not.include("function:mint");
      expect(entries).to.not.include("function:MINTER_ROLE");
      expect(entries).to.not.include("function:pause");
      expect(entries).to.not.include("function:unpause");
      expect(entries).to.not.include("function:grantRole");
    });

    it("Should revert if distribution address is zero", async function () {
      await viem.assertions.revertWithCustomError(
        viem.deployContract("ATTRToken", [zeroAddress]),
        token,
        "ZeroAddress",
      );
    });

    it("Should keep total supply constant at the cap (absent burns)", async function () {
      await token.write.transfer([user1.account.address, parseEther("1000")], {
        account: treasury.account,
      });
      expect(await token.read.totalSupply()).to.equal(CAP);
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
      const supplyBefore = await token.read.totalSupply();
      const burnAmount = parseEther("1000");

      await token.write.burn([burnAmount], { account: user1.account });

      expect(await token.read.totalSupply()).to.equal(supplyBefore - burnAmount);
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

  describe("Access Control removal", function () {
    it("Should no longer expose roles or privileged minting", async function () {
      const abi = token.abi as readonly { type: string; name?: string }[];
      const entries = abi.map((e) => `${e.type}:${e.name ?? ""}`);
      expect(entries).to.not.include("function:hasRole");
      expect(entries).to.not.include("function:DEFAULT_ADMIN_ROLE");
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
