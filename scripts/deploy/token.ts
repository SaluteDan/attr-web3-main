import hre from "hardhat";
import { parseEther } from "viem";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Deploy ATTRToken contract
 * Run with: npx hardhat run scripts/deploy/token.ts --network baseSepolia
 *
 * The token has a fixed, immutable cap of 1,000,000,000 ATTR. The entire cap is minted
 * to the distribution address at deploy; there is no mint function or minter role.
 */
async function main() {
  console.log("Deploying ATTRToken ($ATTR)...");

  const connection = await hre.network.create();
  const [deployer] = await connection.viem.getWalletClients();

  console.log("Deploying with account:", deployer.account.address);

  // Deploy-time distribution address receives the full 1B allocation, then funds the
  // onboarding vault, store inventory pool, and third-party vesting streams.
  const DISTRIBUTION_ADDRESS = (process.env.PLATFORM_TREASURY_ADDRESS ||
    deployer.account.address) as `0x${string}`;

  const CAP = parseEther("1000000000"); // 1 Billion fixed max supply

  console.log("Distribution address:", DISTRIBUTION_ADDRESS);
  console.log("Fixed Cap:", "1,000,000,000 ATTR (fully minted at deploy)");

  const token = await connection.viem.deployContract("ATTRToken", [
    DISTRIBUTION_ADDRESS,
  ]);

  const tokenAddress = token.address;
  console.log("\n✅ ATTRToken deployed to:", tokenAddress);

  console.log("\n=== Deployment Info ===");
  console.log(`ATTR_TOKEN_ADDRESS=${tokenAddress}`);
  console.log("\nVerify on BaseScan:");
  console.log(
    `npx hardhat verify --network baseSepolia ${tokenAddress} ${DISTRIBUTION_ADDRESS}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
