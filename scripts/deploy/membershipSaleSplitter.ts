import hre from "hardhat";
import { formatEther, isAddress } from "viem";
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

  const connection = await hre.network.create();
  const [deployer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  console.log("Deploying with account:", deployer.account.address);

  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH");

  // Configuration
  const treasuryOps = (process.env.TREASURY_OPS_ADDRESS ||
    deployer.account.address) as `0x${string}`;
  const liquidityReceiver = (process.env.LIQUIDITY_RECEIVER_ADDRESS ||
    deployer.account.address) as `0x${string}`;

  if (
    process.env.TREASURY_OPS_ADDRESS &&
    !isAddress(process.env.TREASURY_OPS_ADDRESS)
  ) {
    console.error("❌ TREASURY_OPS_ADDRESS is not a valid Ethereum address");
    process.exit(1);
  }
  if (
    process.env.LIQUIDITY_RECEIVER_ADDRESS &&
    !isAddress(process.env.LIQUIDITY_RECEIVER_ADDRESS)
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
  const splitter = await connection.viem.deployContract(
    "MembershipSaleSplitter",
    [treasuryOps, liquidityReceiver],
  );

  const splitterAddress = splitter.address;
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
