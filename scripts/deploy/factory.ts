import hre from "hardhat";
import { formatEther, zeroAddress } from "viem";
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

  const connection = await hre.network.create();
  const [deployer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  console.log("Deploying with account:", deployer.account.address);

  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH");

  const attrSpenderAddress = (process.env.ATTR_SPENDER_CONTRACT ||
    zeroAddress) as `0x${string}`;

  if (attrSpenderAddress === zeroAddress) {
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

  const factory = await connection.viem.deployContract("ATTRDeployer", [
    deployer.account.address,
    attrSpenderAddress,
  ]);

  const factoryAddress = factory.address;
  console.log("\n✅ ATTRDeployer deployed to:", factoryAddress);

  if (attrSpenderAddress !== zeroAddress) {
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
  console.log(`DEPLOYER_ADDRESS=${deployer.account.address}`);
  console.log("\nCreate a collection:");
  console.log(
    `   npx hardhat run scripts/deploy/test-collection.ts --network baseSepolia`,
  );
  console.log("\nVerify on BaseScan:");
  console.log(
    `npx hardhat verify --network baseSepolia ${factoryAddress} ${deployer.account.address} ${attrSpenderAddress}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
