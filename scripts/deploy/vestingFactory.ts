import hre from "hardhat";
import * as dotenv from "dotenv";
import { isAddress } from "viem";

dotenv.config();

/**
 * Deploy VestingLockCampaignFactory.
 * Run with: npx hardhat run scripts/deploy/vestingFactory.ts --network baseSepolia
 */
async function main() {
  console.log("Deploying VestingLockCampaignFactory...");

  const connection = await hre.network.create();
  const [deployer] = await connection.viem.getWalletClients();

  const initialOwner = (process.env.VESTING_FACTORY_OWNER ||
    process.env.DAO_MULTISIG_ADDRESS ||
    process.env.PLATFORM_TREASURY_ADDRESS ||
    deployer.account.address) as `0x${string}`;

  if (!isAddress(initialOwner)) {
    throw new Error(`Invalid initialOwner address: ${initialOwner}`);
  }

  console.log("Deploying with account:", deployer.account.address);
  console.log("Initial owner:", initialOwner);

  const factory = await connection.viem.deployContract(
    "VestingLockCampaignFactory",
    [initialOwner],
  );

  const factoryAddress = factory.address;
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
