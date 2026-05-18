import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Deploy ATTRSpender contract
 * Run with: npx hardhat run scripts/deploy/attrSpender.ts --network baseSepolia
 *
 * Prerequisites:
 * - ATTR_TOKEN_ADDRESS must be set in .env (deploy token.ts first)
 * - Factory will be the owner, so deploy factory.ts after this
 */
async function main() {
  console.log("🚀 Deploying ATTRSpender...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Get account balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Configuration
  const attrTokenAddress = process.env.ATTR_TOKEN_ADDRESS;
  if (!attrTokenAddress) {
    console.error("❌ ATTR_TOKEN_ADDRESS not set in .env");
    console.log(
      "Deploy ATTRToken first: npx hardhat run scripts/deploy/token.ts --network baseSepolia",
    );
    process.exit(1);
  }

  // The deployer will be the initial owner - ownership transfers to factory after deployment
  const initialOwner = deployer.address;

  console.log("\n📋 Deployment Parameters:");
  console.log(`   ATTR Token: ${attrTokenAddress}`);
  console.log(`   Initial Owner: ${initialOwner} (will transfer to factory)`);

  // Deploy ATTRSpender
  const ATTRSpenderFactory = await ethers.getContractFactory("ATTRSpender");
  const attrSpender = await ATTRSpenderFactory.deploy(
    attrTokenAddress,
    initialOwner,
  );
  await attrSpender.waitForDeployment();

  const spenderAddress = await attrSpender.getAddress();
  console.log("\n✅ ATTRSpender deployed to:", spenderAddress);

  console.log("\n=== Deployment Complete ===");
  console.log("Add this to your .env file:");
  console.log(`ATTR_SPENDER_CONTRACT=${spenderAddress}`);
  console.log("\nNext steps:");
  console.log("1. Deploy ATTRDeployer factory with ATTR_SPENDER_CONTRACT");
  console.log("2. Factory will auto-authorize collections in ATTRSpender");
  console.log("\nVerify on BaseScan:");
  console.log(
    `npx hardhat verify --network baseSepolia ${spenderAddress} ${attrTokenAddress} ${initialOwner}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
