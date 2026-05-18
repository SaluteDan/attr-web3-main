import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as rl from "readline";

dotenv.config();

/**
 * Transfer ATTRSpender ownership from deployer to ATTRDeployer factory.
 *
 * This is a post-deployment step required for the factory to auto-authorize
 * new NFT collections for ATTR payments.
 *
 * Prerequisites:
 * - ATTRSpender must be deployed (ATTR_SPENDER_CONTRACT set in .env)
 * - ATTRDeployer factory must be deployed (FACTORY_CONTRACT_ADDRESS set in .env)
 * - Current deployer must be the owner of ATTRSpender
 *
 * Usage:
 *   npx hardhat run scripts/transfer/attrSpenderOwnership.ts --network baseSepolia
 *
 * Required ENV vars:
 *   - ATTR_SPENDER_CONTRACT: Deployed ATTRSpender address
 *   - FACTORY_CONTRACT_ADDRESS: Deployed ATTRDeployer factory address
 */

async function main() {
  console.log("🔐 ATTRSpender Ownership Transfer Script\n");

  // Load configuration
  const SPENDER_ADDRESS = process.env.ATTR_SPENDER_CONTRACT;
  const FACTORY_ADDRESS = process.env.FACTORY_CONTRACT_ADDRESS;

  if (!SPENDER_ADDRESS) {
    throw new Error("ATTR_SPENDER_CONTRACT not set in .env");
  }
  if (!FACTORY_ADDRESS) {
    throw new Error("FACTORY_CONTRACT_ADDRESS not set in .env");
  }

  // Validate address formats
  if (!ethers.isAddress(SPENDER_ADDRESS)) {
    throw new Error("ATTR_SPENDER_CONTRACT is not a valid Ethereum address");
  }
  if (!ethers.isAddress(FACTORY_ADDRESS)) {
    throw new Error("FACTORY_CONTRACT_ADDRESS is not a valid Ethereum address");
  }

  const normalizedSpender = ethers.getAddress(SPENDER_ADDRESS);
  const normalizedFactory = ethers.getAddress(FACTORY_ADDRESS);
  if (normalizedSpender === normalizedFactory) {
    throw new Error(
      "ATTR_SPENDER_CONTRACT and FACTORY_CONTRACT_ADDRESS cannot be the same address",
    );
  }

  const [deployer] = await ethers.getSigners();

  console.log("Executing from account:", deployer.address);
  console.log("ATTRSpender Address:", normalizedSpender);
  console.log("New Owner (Factory):", normalizedFactory);

  // Connect to ATTRSpender using TypeChain-generated factory
  const { ATTRSpender__factory } = await import("../../src/index");
  const spender = ATTRSpender__factory.connect(normalizedSpender, deployer);

  // Verify current owner
  const currentOwner = await spender.owner();
  console.log("\nCurrent Owner:", currentOwner);

  if (currentOwner !== deployer.address) {
    throw new Error(
      `Deployer is not the current owner. Current owner: ${currentOwner}`,
    );
  }

  if (currentOwner === normalizedFactory) {
    console.log("\n✅ Factory is already the owner of ATTRSpender.");
    console.log("No transfer needed.");
    return;
  }

  console.log("\n✅ Deployer verified as current owner\n");

  // Confirmation prompt
  console.log(
    "⚠️  WARNING: You are about to transfer ownership of ATTRSpender.",
  );
  console.log("After this, the factory contract will control authorization.\n");

  // For non-interactive environments, set SKIP_CONFIRMATION=true
  if (process.env.SKIP_CONFIRMATION !== "true") {
    const readline = rl.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    await new Promise((resolve) => {
      readline.question('Type "CONFIRM" to proceed: ', (answer: string) => {
        readline.close();
        if (answer !== "CONFIRM") {
          console.log("Operation cancelled.");
          process.exit(0);
        }
        resolve(true);
      });
    });
  }

  console.log("\n🚀 Transferring ownership to factory...");

  // Execute ownership transfer
  const tx = await spender.transferOwnership(normalizedFactory);
  await tx.wait();
  console.log("✅ Ownership transfer complete. Tx:", tx.hash);

  // Verify the transfer
  console.log("\n=== Ownership Verification ===");
  const newOwner = await spender.owner();
  console.log("New Owner:", newOwner);

  if (newOwner === normalizedFactory) {
    console.log(
      "\n🎉 ATTRSpender ownership successfully transferred to factory!",
    );
    console.log(
      "\nThe factory can now auto-authorize new collections for ATTR payments.",
    );
  } else {
    console.log("\n⚠️  WARNING: Ownership verification failed!");
    console.log(`Expected: ${normalizedFactory}`);
    console.log(`Actual:   ${newOwner}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
