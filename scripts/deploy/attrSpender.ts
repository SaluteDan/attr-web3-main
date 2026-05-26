import hre from "hardhat";
import { formatEther } from "viem";
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

  const connection = await hre.network.create();
  const [deployer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  console.log("Deploying with account:", deployer.account.address);

  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH");

  const attrTokenAddress = process.env.ATTR_TOKEN_ADDRESS;
  if (!attrTokenAddress) {
    console.error("❌ ATTR_TOKEN_ADDRESS not set in .env");
    console.log(
      "Deploy ATTRToken first: npx hardhat run scripts/deploy/token.ts --network baseSepolia",
    );
    process.exit(1);
  }

  const initialOwner = deployer.account.address;

  console.log("\n📋 Deployment Parameters:");
  console.log(`   ATTR Token: ${attrTokenAddress}`);
  console.log(`   Initial Owner: ${initialOwner} (will transfer to factory)`);

  const attrSpender = await connection.viem.deployContract("ATTRSpender", [
    attrTokenAddress as `0x${string}`,
    initialOwner,
  ]);

  const spenderAddress = attrSpender.address;
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
