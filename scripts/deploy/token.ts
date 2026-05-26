import hre from "hardhat";
import { parseEther } from "viem";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Deploy ATTRToken contract
 * Run with: npx hardhat run scripts/deploy-token.ts --network baseSepolia
 */
async function main() {
  console.log("Deploying ATTRToken ($ATTR)...");

  const connection = await hre.network.create();
  const [deployer] = await connection.viem.getWalletClients();

  console.log("Deploying with account:", deployer.account.address);

  const TREASURY_ADDRESS = (process.env.PLATFORM_TREASURY_ADDRESS ||
    deployer.account.address) as `0x${string}`;

  // Tokenomics (Adjust these values as needed)
  const CAP_AMOUNT = 1_000_000_000; // 1 Billion Max Supply
  const INITIAL_MINT = 100_000_000; // 100 Million Initial Supply (10%)

  const cap = parseEther(CAP_AMOUNT.toString());
  const initialSupply = parseEther(INITIAL_MINT.toString());

  console.log("Treasury:", TREASURY_ADDRESS);
  console.log("Max Cap:", CAP_AMOUNT.toLocaleString(), "ATTR");
  console.log("Initial Mint:", INITIAL_MINT.toLocaleString(), "ATTR");

  const token = await connection.viem.deployContract("ATTRToken", [
    cap,
    initialSupply,
    TREASURY_ADDRESS,
  ]);

  const tokenAddress = token.address;
  console.log("\n✅ ATTRToken deployed to:", tokenAddress);

  console.log("\n=== Deployment Info ===");
  console.log(`ATTR_TOKEN_ADDRESS=${tokenAddress}`);
  console.log("\nVerify on BaseScan:");
  console.log(
    `npx hardhat verify --network baseSepolia ${tokenAddress} ${cap} ${initialSupply} ${TREASURY_ADDRESS}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
