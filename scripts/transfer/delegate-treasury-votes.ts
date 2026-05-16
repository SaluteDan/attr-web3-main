import { ethers } from "hardhat";
import * as dotenv from "dotenv";

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

  // This script should be run with the treasury wallet as the signer
  const [treasury] = await ethers.getSigners();
  console.log("Treasury Address:", treasury.address);
  console.log("Token Address:", TOKEN_ADDRESS);

  const token = await ethers.getContractAt("ATTRToken", TOKEN_ADDRESS);

  // Check current state
  const balance = await token.balanceOf(treasury.address);
  const currentDelegate = await token.delegates(treasury.address);
  const currentVotes = await token.getVotes(treasury.address);

  console.log("\n=== Current State ===");
  console.log("Treasury Balance:", ethers.formatEther(balance), "ATTR");
  console.log("Current Delegate:", currentDelegate);
  console.log(
    "Current Voting Power:",
    ethers.formatEther(currentVotes),
    "ATTR",
  );

  if (currentDelegate === treasury.address) {
    console.log("\n✅ Treasury is already self-delegated.");
    console.log(
      "Voting power is active:",
      ethers.formatEther(currentVotes),
      "ATTR",
    );
    return;
  }

  // Self-delegate
  console.log("\n🔄 Delegating voting power to self...");
  const tx = await token.delegate(treasury.address);
  console.log("Transaction submitted:", tx.hash);

  await tx.wait();
  console.log("✅ Transaction confirmed");

  // Verify
  const newDelegate = await token.delegates(treasury.address);
  const newVotes = await token.getVotes(treasury.address);

  console.log("\n=== Final State ===");
  console.log("New Delegate:", newDelegate);
  console.log("New Voting Power:", ethers.formatEther(newVotes), "ATTR");

  if (newDelegate === treasury.address && newVotes === balance) {
    console.log("\n🎉 Treasury voting power successfully activated!");
  } else {
    console.log("\n⚠️  WARNING: Delegation may not have completed correctly.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
