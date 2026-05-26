import hre from "hardhat";
import { getContract, formatEther } from "viem";
import * as dotenv from "dotenv";
import { ATTRTokenABI } from "../../src/index.js";

dotenv.config();

/**
 * Delegate Treasury Voting Power Script
 *
 * This script enables the treasury wallet's voting power by self-delegating.
 * Without delegation, the initial 100M ATTR tokens have ZERO voting weight.
 *
 * CRITICAL: Run this from the treasury wallet after deployment.
 *
 * Usage:
 *   npx hardhat run scripts/delegate-treasury-votes.ts --network baseMainnet
 *
 * Required ENV vars:
 *   - ATTR_TOKEN_ADDRESS: Deployed token contract address
 */

async function main() {
  console.log("🗳️  Treasury Voting Power Delegation Script\n");

  const TOKEN_ADDRESS = process.env.ATTR_TOKEN_ADDRESS;

  if (!TOKEN_ADDRESS) {
    throw new Error("ATTR_TOKEN_ADDRESS not set in .env");
  }

  const connection = await hre.network.create();
  const [treasury] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  console.log("Treasury Address:", treasury.account.address);
  console.log("Token Address:", TOKEN_ADDRESS);

  const token = getContract({
    address: TOKEN_ADDRESS as `0x${string}`,
    abi: ATTRTokenABI,
    client: { public: publicClient, wallet: treasury },
  });

  const balance = await token.read.balanceOf([treasury.account.address]);
  const currentDelegate = await token.read.delegates([
    treasury.account.address,
  ]);
  const currentVotes = await token.read.getVotes([treasury.account.address]);

  console.log("\n=== Current State ===");
  console.log("Treasury Balance:", formatEther(balance as bigint), "ATTR");
  console.log("Current Delegate:", currentDelegate);
  console.log(
    "Current Voting Power:",
    formatEther(currentVotes as bigint),
    "ATTR",
  );

  if (currentDelegate === treasury.account.address) {
    console.log("\n✅ Treasury is already self-delegated.");
    console.log(
      "Voting power is active:",
      formatEther(currentVotes as bigint),
      "ATTR",
    );
    return;
  }

  console.log("\n🔄 Delegating voting power to self...");
  const txHash = await token.write.delegate([treasury.account.address]);
  console.log("Transaction submitted:", txHash);

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("✅ Transaction confirmed");

  const newDelegate = await token.read.delegates([treasury.account.address]);
  const newVotes = await token.read.getVotes([treasury.account.address]);

  console.log("\n=== Final State ===");
  console.log("New Delegate:", newDelegate);
  console.log("New Voting Power:", formatEther(newVotes as bigint), "ATTR");

  if (newDelegate === treasury.account.address && newVotes === balance) {
    console.log("\n🎉 Treasury voting power successfully activated!");
  } else {
    console.log("\n⚠️  WARNING: Delegation may not have completed correctly.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
