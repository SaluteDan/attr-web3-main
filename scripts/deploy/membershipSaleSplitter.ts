import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Deploy MembershipSaleSplitter contract
 * Run with: npx hardhat run scripts/deploy/membershipSaleSplitter.ts --network baseSepolia
 *
 * This contract receives ETH from MembershipToken sales and splits:
 * - 70% to Treasury operations
 * - 30% to LP capital (for ATTR/WETH liquidity)
 */
async function main() {
  console.log("🚀 Deploying MembershipSaleSplitter...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Get account balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Configuration
  const treasuryOps = process.env.TREASURY_OPS_ADDRESS || deployer.address;
  const liquidityReceiver =
    process.env.LIQUIDITY_RECEIVER_ADDRESS || deployer.address;

  if (
    process.env.TREASURY_OPS_ADDRESS &&
    !ethers.isAddress(process.env.TREASURY_OPS_ADDRESS)
  ) {
    console.error("❌ TREASURY_OPS_ADDRESS is not a valid Ethereum address");
    process.exit(1);
  }
  if (
    process.env.LIQUIDITY_RECEIVER_ADDRESS &&
    !ethers.isAddress(process.env.LIQUIDITY_RECEIVER_ADDRESS)
  ) {
    console.error(
      "❌ LIQUIDITY_RECEIVER_ADDRESS is not a valid Ethereum address",
    );
    process.exit(1);
  }

  console.log("\n📋 Deployment Parameters:");
  console.log(`   Treasury Ops (70%): ${treasuryOps}`);
  console.log(`   Liquidity Receiver (30%): ${liquidityReceiver}`);
  console.log("\n⚠️  IMPORTANT: This split is IMMUTABLE after deployment!");

  // Deploy MembershipSaleSplitter
  const SplitterFactory = await ethers.getContractFactory(
    "MembershipSaleSplitter",
  );
  const splitter = await SplitterFactory.deploy(treasuryOps, liquidityReceiver);
  await splitter.waitForDeployment();

  const splitterAddress = await splitter.getAddress();
  console.log("\n✅ MembershipSaleSplitter deployed to:", splitterAddress);

  console.log("\n=== Deployment Complete ===");
  console.log("Add this to your .env file:");
  console.log(`MEMBERSHIP_SALE_SPLITTER_ADDRESS=${splitterAddress}`);
  console.log("\nNext steps:");
  console.log(
    "1. Deploy MembershipToken with paymentReceiver = this splitter address",
  );
  console.log("2. Or update existing MembershipToken.setPaymentReceiver()");
  console.log("\nVerify on BaseScan:");
  console.log(
    `npx hardhat verify --network baseSepolia ${splitterAddress} ${treasuryOps} ${liquidityReceiver}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
