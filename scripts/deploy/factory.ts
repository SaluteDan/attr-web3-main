import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Deploy ATTRDeployer contract (Collection Factory)
 * Run with: npx hardhat run scripts/deploy/factory.ts --network baseSepolia
 *
 * Prerequisites:
 * - ATTRSpender should be deployed first (optional, can use address(0))
 * - Factory becomes the owner of ATTRSpender and auto-authorizes new collections
 */
async function main() {
  console.log("🚀 Deploying ATTRDeployer (Collection Factory)...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Get account balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // ATTRSpender must be deployed first for ATTR payment routing
  // Set to address(0) to skip ATTR routing (ETH-only collections)
  const attrSpenderAddress =
    process.env.ATTR_SPENDER_CONTRACT || ethers.ZeroAddress;

  if (attrSpenderAddress === ethers.ZeroAddress) {
    console.log(
      "⚠️  ATTR_SPENDER_CONTRACT not set — collections will be ETH-only (no ATTR payments)",
    );
    console.log(
      "   To enable ATTR: deploy attrSpender.ts first, then set ATTR_SPENDER_CONTRACT",
    );
  } else {
    console.log("✅ ATTRSpender:", attrSpenderAddress);
    console.log(
      "   Factory will auto-authorize new collections for ATTR payments",
    );
  }

  // Deploy Factory
  const Factory = await ethers.getContractFactory("ATTRDeployer");
  const factory = await Factory.deploy(deployer.address, attrSpenderAddress);
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  console.log("\n✅ ATTRDeployer deployed to:", factoryAddress);

  // If ATTRSpender was deployed, transfer ownership to factory
  if (attrSpenderAddress !== ethers.ZeroAddress) {
    console.log("\n📋 Post-Deployment Step:");
    console.log(
      "   Transfer ATTR Spender contract ownership to factory contract:",
    );
    console.log(
      `   npx hardhat run scripts/transfer/attrSpenderOwnership.ts --network baseSepolia`,
    );
  }

  console.log("\n=== Deployment Complete ===");
  console.log("Add this to your .env file:");
  console.log(`FACTORY_CONTRACT_ADDRESS=${factoryAddress}`);
  console.log(`DEPLOYER_ADDRESS=${deployer.address}`);
  console.log("\nCreate a collection:");
  console.log(
    `   npx hardhat run scripts/deploy/test-collection.ts --network baseSepolia`,
  );
  console.log("\nVerify on BaseScan:");
  console.log(
    `npx hardhat verify --network baseSepolia ${factoryAddress} ${deployer.address} ${attrSpenderAddress}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
