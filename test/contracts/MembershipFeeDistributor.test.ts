import { expect } from "chai";
import { ethers } from "hardhat";
import {
  MembershipFeeDistributor,
  MembershipToken,
  ATTRToken,
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MembershipFeeDistributor", function () {
  let distributor: MembershipFeeDistributor;
  let membership: MembershipToken;
  let attr: ATTRToken;
  let dao: SignerWithAddress; // owner (DAO multisig)
  let user1: SignerWithAddress; // holds token ID 0
  let user2: SignerWithAddress; // holds token ID 1
  let user3: SignerWithAddress; // holds token ID 2
  let stranger: SignerWithAddress;

  // 3 tokens minted in beforeEach
  const TOTAL_MINTED = 3n;

  beforeEach(async function () {
    [dao, user1, user2, user3, stranger] = await ethers.getSigners();

    // ── Deploy MembershipToken and mint 3 tokens ───────────────────────────
    const Membership = await ethers.getContractFactory("MembershipToken");
    membership = (await Membership.deploy(
      "ATTR-MEMBER-ID",
      "ATTR#",
      dao.address, // initialOwner
      dao.address, // paymentReceiver
      dao.address, // royaltyReceiver
      500n, // 5% royalty
      "ipfs://test", // contractURI
      50000n, // maxSupply
      5n, // maxMintPerWallet
    )) as unknown as MembershipToken;
    await membership.waitForDeployment();

    // Mint token 0 → user1, token 1 → user2, token 2 → user3
    await membership
      .connect(dao)
      .adminMintMembership(user1.address, 1, "ipfs://1");
    await membership
      .connect(dao)
      .adminMintMembership(user2.address, 1, "ipfs://2");
    await membership
      .connect(dao)
      .adminMintMembership(user3.address, 1, "ipfs://3");

    // ── Deploy ATTRToken ───────────────────────────────────────────────────
    const ATTR = await ethers.getContractFactory("ATTRToken");
    attr = (await ATTR.deploy(
      ethers.parseEther("1000000"),
      ethers.parseEther("10000"),
      dao.address,
    )) as unknown as ATTRToken;
    await attr.waitForDeployment();

    // ── Deploy MembershipFeeDistributor ────────────────────────────────────
    const Distributor = await ethers.getContractFactory(
      "MembershipFeeDistributor",
    );
    distributor = (await Distributor.deploy(
      await membership.getAddress(),
      dao.address,
    )) as unknown as MembershipFeeDistributor;
    await distributor.waitForDeployment();

    // Set snapshot so deposits are accepted
    await distributor.connect(dao).setTotalMintedSnapshot(TOTAL_MINTED);
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("Should store membershipToken address", async function () {
      expect(await distributor.membershipToken()).to.equal(
        await membership.getAddress(),
      );
    });

    it("Should set correct owner", async function () {
      expect(await distributor.owner()).to.equal(dao.address);
    });

    it("Should revert on zero membershipToken address", async function () {
      const Distributor = await ethers.getContractFactory(
        "MembershipFeeDistributor",
      );
      await expect(
        Distributor.deploy(ethers.ZeroAddress, dao.address),
      ).to.be.revertedWithCustomError(distributor, "ZeroAddress");
    });

    it("Should revert on zero daoOwner address", async function () {
      const Distributor = await ethers.getContractFactory(
        "MembershipFeeDistributor",
      );
      await expect(
        Distributor.deploy(await membership.getAddress(), ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(distributor, "OwnableInvalidOwner");
    });
  });

  // ── setTotalMintedSnapshot ─────────────────────────────────────────────────

  describe("setTotalMintedSnapshot", function () {
    it("Should update the snapshot and emit event", async function () {
      await expect(distributor.connect(dao).setTotalMintedSnapshot(10n))
        .to.emit(distributor, "TotalMintedSnapshotUpdated")
        .withArgs(TOTAL_MINTED, 10n);
      expect(await distributor.totalMintedSnapshot()).to.equal(10n);
    });

    it("Should revert if called by non-owner", async function () {
      await expect(
        distributor.connect(stranger).setTotalMintedSnapshot(10n),
      ).to.be.revertedWithCustomError(
        distributor,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  // ── depositETH ─────────────────────────────────────────────────────────────

  describe("depositETH", function () {
    it("Should update the ETH reward index on deposit", async function () {
      const depositAmount = ethers.parseEther("3"); // 1 ETH per token
      await expect(
        distributor.connect(dao).depositETH({ value: depositAmount }),
      ).to.emit(distributor, "ETHDeposited");
    });

    it("Should revert on zero deposit", async function () {
      await expect(
        distributor.connect(dao).depositETH({ value: 0n }),
      ).to.be.revertedWithCustomError(distributor, "ZeroDeposit");
    });

    it("Should revert if totalMintedSnapshot is 0", async function () {
      const Distributor = await ethers.getContractFactory(
        "MembershipFeeDistributor",
      );
      const fresh = await Distributor.deploy(
        await membership.getAddress(),
        dao.address,
      );
      await fresh.waitForDeployment();
      await expect(
        fresh.connect(dao).depositETH({ value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(distributor, "InvalidMaxSupply");
    });

    it("Should revert if called by non-owner", async function () {
      await expect(
        distributor
          .connect(stranger)
          .depositETH({ value: ethers.parseEther("1") }),
      ).to.be.revertedWithCustomError(
        distributor,
        "OwnableUnauthorizedAccount",
      );
    });

    it("Should reject direct ETH sends (receive reverts)", async function () {
      await expect(
        dao.sendTransaction({
          to: await distributor.getAddress(),
          value: ethers.parseEther("1"),
        }),
      ).to.be.revertedWithCustomError(distributor, "ZeroDeposit");
    });
  });

  // ── claimETH ───────────────────────────────────────────────────────────────

  describe("claimETH", function () {
    const PER_TOKEN = ethers.parseEther("1");

    beforeEach(async function () {
      // Deposit 3 ETH → 1 ETH per token
      await distributor
        .connect(dao)
        .depositETH({ value: PER_TOKEN * TOTAL_MINTED });
    });

    it("claimableETH should return 1 ETH per token before claim", async function () {
      expect(await distributor.claimableETH([0n])).to.equal(PER_TOKEN);
      expect(await distributor.claimableETH([1n])).to.equal(PER_TOKEN);
      expect(await distributor.claimableETH([2n])).to.equal(PER_TOKEN);
      expect(await distributor.claimableETH([0n, 1n, 2n])).to.equal(
        PER_TOKEN * 3n,
      );
    });

    it("Should transfer 1 ETH to user1 for token 0", async function () {
      const before = await ethers.provider.getBalance(user1.address);
      const tx = await distributor.connect(user1).claimETH([0n]);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(user1.address);
      expect(after - before + gasUsed).to.equal(PER_TOKEN);
    });

    it("Should emit ETHClaimed event", async function () {
      await expect(distributor.connect(user1).claimETH([0n]))
        .to.emit(distributor, "ETHClaimed")
        .withArgs(user1.address, [0n], PER_TOKEN);
    });

    it("Should set claimable to 0 after claim", async function () {
      await distributor.connect(user1).claimETH([0n]);
      expect(await distributor.claimableETH([0n])).to.equal(0n);
    });

    it("Should allow batch claim for multiple tokens owned by same user", async function () {
      // Give user1 a second token via transfer from user2
      await membership
        .connect(user2)
        .transferFrom(user2.address, user1.address, 1n);
      const before = await ethers.provider.getBalance(user1.address);
      const tx = await distributor.connect(user1).claimETH([0n, 1n]);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(user1.address);
      expect(after - before + gasUsed).to.equal(PER_TOKEN * 2n);
    });

    it("Should revert on empty tokenIds array", async function () {
      await expect(
        distributor.connect(user1).claimETH([]),
      ).to.be.revertedWithCustomError(distributor, "NoTokenIds");
    });

    it("Should revert if caller does not own a token ID", async function () {
      // user1 tries to claim token 1 (owned by user2)
      await expect(
        distributor.connect(user1).claimETH([1n]),
      ).to.be.revertedWithCustomError(distributor, "NotTokenOwner");
    });

    it("Should revert with NothingToClaim if no rewards have accumulated since last claim", async function () {
      await distributor.connect(user1).claimETH([0n]); // first claim
      await expect(
        distributor.connect(user1).claimETH([0n]), // no new deposit
      ).to.be.revertedWithCustomError(distributor, "NothingToClaim");
    });

    it("Should accumulate rewards across multiple deposits", async function () {
      // Second deposit of another 1 ETH per token
      await distributor
        .connect(dao)
        .depositETH({ value: PER_TOKEN * TOTAL_MINTED });

      expect(await distributor.claimableETH([0n])).to.equal(PER_TOKEN * 2n);
      const before = await ethers.provider.getBalance(user1.address);
      const tx = await distributor.connect(user1).claimETH([0n]);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(user1.address);
      expect(after - before + gasUsed).to.equal(PER_TOKEN * 2n);
    });
  });

  // ── depositERC20 + claimERC20 ──────────────────────────────────────────────

  describe("ERC20 rewards (depositERC20 + claimERC20)", function () {
    const PER_TOKEN_ERC20 = ethers.parseEther("100"); // 100 ATTR per token
    let attrAddr: string;

    beforeEach(async function () {
      attrAddr = await attr.getAddress();
      const totalDeposit = PER_TOKEN_ERC20 * TOTAL_MINTED;
      await attr
        .connect(dao)
        .approve(await distributor.getAddress(), totalDeposit);
      await distributor.connect(dao).depositERC20(attrAddr, totalDeposit);
    });

    it("claimableERC20 should return 100 ATTR per token", async function () {
      expect(await distributor.claimableERC20(attrAddr, [0n])).to.equal(
        PER_TOKEN_ERC20,
      );
      expect(await distributor.claimableERC20(attrAddr, [0n, 1n, 2n])).to.equal(
        PER_TOKEN_ERC20 * 3n,
      );
    });

    it("Should transfer 100 ATTR to user1 for token 0", async function () {
      const before = await attr.balanceOf(user1.address);
      await expect(distributor.connect(user1).claimERC20(attrAddr, [0n]))
        .to.emit(distributor, "ERC20Claimed")
        .withArgs(user1.address, attrAddr, [0n], PER_TOKEN_ERC20);
      expect(await attr.balanceOf(user1.address)).to.equal(
        before + PER_TOKEN_ERC20,
      );
    });

    it("Should set claimable to 0 after ERC20 claim", async function () {
      await distributor.connect(user1).claimERC20(attrAddr, [0n]);
      expect(await distributor.claimableERC20(attrAddr, [0n])).to.equal(0n);
    });

    it("Should revert on empty tokenIds array", async function () {
      await expect(
        distributor.connect(user1).claimERC20(attrAddr, []),
      ).to.be.revertedWithCustomError(distributor, "NoTokenIds");
    });

    it("Should revert if caller does not own the token", async function () {
      await expect(
        distributor.connect(user1).claimERC20(attrAddr, [1n]),
      ).to.be.revertedWithCustomError(distributor, "NotTokenOwner");
    });

    it("Should revert with NothingToClaim on double claim", async function () {
      await distributor.connect(user1).claimERC20(attrAddr, [0n]);
      await expect(
        distributor.connect(user1).claimERC20(attrAddr, [0n]),
      ).to.be.revertedWithCustomError(distributor, "NothingToClaim");
    });

    it("Should revert depositERC20 on zero amount", async function () {
      await expect(
        distributor.connect(dao).depositERC20(attrAddr, 0n),
      ).to.be.revertedWithCustomError(distributor, "ZeroDeposit");
    });

    it("Should revert depositERC20 if called by non-owner", async function () {
      await attr.transfer(stranger.address, PER_TOKEN_ERC20);
      await attr
        .connect(stranger)
        .approve(await distributor.getAddress(), PER_TOKEN_ERC20);
      await expect(
        distributor.connect(stranger).depositERC20(attrAddr, PER_TOKEN_ERC20),
      ).to.be.revertedWithCustomError(
        distributor,
        "OwnableUnauthorizedAccount",
      );
    });
  });
});
