import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Deploy VestingLockCampaignFactory.
 * Run with: npx hardhat run scripts/deploy/vestingFactory.ts --network baseSepolia
 */
async function main() {
  console.log("Deploying VestingLockCampaignFactory...");

  const [deployer] = await ethers.getSigners();
  const initialOwner =
    process.env.VESTING_FACTORY_OWNER ||
    process.env.DAO_MULTISIG_ADDRESS ||
    process.env.PLATFORM_TREASURY_ADDRESS ||
    deployer.address;

  console.log("Deploying with account:", deployer.address);
  console.log("Initial owner:", initialOwner);

  const Factory = await ethers.getContractFactory("VestingLockCampaignFactory");
  const factory = await Factory.deploy(initialOwner);
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  console.log("\nVestingLockCampaignFactory deployed to:", factoryAddress);

  console.log("\n=== Deployment Info ===");
  console.log(`VESTING_LOCK_CAMPAIGN_FACTORY_ADDRESS=${factoryAddress}`);
  console.log("\nVerify on BaseScan:");
  console.log(
    `npx hardhat verify --network baseSepolia ${factoryAddress} ${initialOwner}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
