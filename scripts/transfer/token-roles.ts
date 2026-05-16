import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Post-Deployment Role Transfer Script for ATTRToken
 *
 * This script transfers control from the deployer EOA to a multisig and backend relayer.
 *
 * CRITICAL: Run this immediately after mainnet deployment to secure the token.
 *
 * Steps:
 * 1. Grant DEFAULT_ADMIN_ROLE to Gnosis Safe (multisig)
 * 2. Grant MINTER_ROLE to backend relayer wallet
 * 3. Revoke DEFAULT_ADMIN_ROLE from deployer
 * 4. Revoke MINTER_ROLE from deployer
 *
 * Usage:
 *   npx hardhat run scripts/transfer-token-roles.ts --network baseMainnet
 *
 * Required ENV vars:
 *   - ATTR_TOKEN_ADDRESS: Deployed token contract address
 *   - GNOSIS_SAFE_ADDRESS: Multisig address for admin role
 *   - RELAYER_ADDRESS: Backend wallet for minting operations
 */

async function main() {
  console.log("🔐 ATTRToken Role Transfer Script\n");

  // Load configuration
  const TOKEN_ADDRESS = process.env.ATTR_TOKEN_ADDRESS;
  const GNOSIS_SAFE = process.env.GNOSIS_SAFE_ADDRESS;
  const RELAYER = process.env.RELAYER_ADDRESS;

  if (!TOKEN_ADDRESS) {
    throw new Error("ATTR_TOKEN_ADDRESS not set in .env");
  }
  if (!GNOSIS_SAFE) {
    throw new Error("GNOSIS_SAFE_ADDRESS not set in .env");
  }
  if (!RELAYER) {
    throw new Error("RELAYER_ADDRESS not set in .env");
  }

  // Validate address formats
  if (!ethers.isAddress(TOKEN_ADDRESS)) {
    throw new Error("ATTR_TOKEN_ADDRESS is not a valid Ethereum address");
  }
  if (!ethers.isAddress(GNOSIS_SAFE)) {
    throw new Error("GNOSIS_SAFE_ADDRESS is not a valid Ethereum address");
  }
  if (!ethers.isAddress(RELAYER)) {
    throw new Error("RELAYER_ADDRESS is not a valid Ethereum address");
  }
  // Normalize addresses for consistent comparison
  const normalizedSafe = ethers.getAddress(GNOSIS_SAFE);
  const normalizedRelayer = ethers.getAddress(RELAYER);

  // Validate addresses are unique
  if (normalizedSafe === normalizedRelayer) {
    throw new Error(
      "GNOSIS_SAFE_ADDRESS and RELAYER_ADDRESS must be different",
    );
  }

  const [deployer] = await ethers.getSigners();

  // Validate targets are not the deployer
  if (
    normalizedSafe === deployer.address ||
    normalizedRelayer === deployer.address
  ) {
    throw new Error("Target addresses cannot be the deployer address");
  }

  console.log("Executing from deployer:", deployer.address);
  console.log("Token Address:", TOKEN_ADDRESS);
  console.log("Gnosis Safe (new admin):", GNOSIS_SAFE);
  console.log("Relayer (new minter):", RELAYER);

  // Connect to deployed token
  const token = await ethers.getContractAt("ATTRToken", TOKEN_ADDRESS);

  // Role identifiers
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

  // Verify deployer has admin role
  const hasAdminRole = await token.hasRole(
    DEFAULT_ADMIN_ROLE,
    deployer.address,
  );
  if (!hasAdminRole) {
    throw new Error(
      "Deployer does not have DEFAULT_ADMIN_ROLE. Cannot proceed.",
    );
  }

  // Verify deployer has minter role
  const hasMinterRole = await token.hasRole(MINTER_ROLE, deployer.address);
  if (!hasMinterRole) {
    throw new Error("Deployer does not have MINTER_ROLE. Cannot proceed.");
  }

  console.log("\n✅ Deployer verified as current admin\n");

  // Confirmation prompt
  console.log(
    "⚠️  WARNING: You are about to transfer control of the token contract.",
  );
  console.log("This operation is IRREVERSIBLE on mainnet.\n");
  console.log("Please verify the addresses above are correct.\n");

  // For non-interactive environments, set SKIP_CONFIRMATION=true
  if (process.env.SKIP_CONFIRMATION !== "true") {
    const readline = require("readline").createInterface({
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

  console.log("\n🚀 Starting role transfer...\n");

  // Step 1: Grant DEFAULT_ADMIN_ROLE to Gnosis Safe
  console.log("Step 1/4: Granting DEFAULT_ADMIN_ROLE to Gnosis Safe...");
  const tx1 = await token.grantRole(DEFAULT_ADMIN_ROLE, GNOSIS_SAFE);
  await tx1.wait();
  console.log("✅ Admin role granted to Safe. Tx:", tx1.hash);

  // Step 2: Grant MINTER_ROLE to Relayer
  console.log("\nStep 2/4: Granting MINTER_ROLE to Relayer...");
  const tx2 = await token.grantRole(MINTER_ROLE, RELAYER);
  await tx2.wait();
  console.log("✅ Minter role granted to Relayer. Tx:", tx2.hash);

  // Step 3: Revoke DEFAULT_ADMIN_ROLE from Deployer
  console.log("\nStep 3/4: Revoking DEFAULT_ADMIN_ROLE from Deployer...");
  const tx3 = await token.revokeRole(DEFAULT_ADMIN_ROLE, deployer.address);
  await tx3.wait();
  console.log("✅ Admin role revoked from Deployer. Tx:", tx3.hash);

  // Step 4: Revoke MINTER_ROLE from Deployer
  console.log("\nStep 4/4: Revoking MINTER_ROLE from Deployer...");
  const tx4 = await token.revokeRole(MINTER_ROLE, deployer.address);
  await tx4.wait();
  console.log("✅ Minter role revoked from Deployer. Tx:", tx4.hash);

  // Final verification
  console.log("\n=== Final Role Verification ===");
  const safeHasAdmin = await token.hasRole(DEFAULT_ADMIN_ROLE, GNOSIS_SAFE);
  const relayerHasMinter = await token.hasRole(MINTER_ROLE, RELAYER);
  const deployerHasAdmin = await token.hasRole(
    DEFAULT_ADMIN_ROLE,
    deployer.address,
  );
  const deployerHasMinter = await token.hasRole(MINTER_ROLE, deployer.address);

  console.log(
    "Gnosis Safe has DEFAULT_ADMIN_ROLE:",
    safeHasAdmin ? "✅" : "❌",
  );
  console.log("Relayer has MINTER_ROLE:", relayerHasMinter ? "✅" : "❌");
  console.log(
    "Deployer has DEFAULT_ADMIN_ROLE:",
    deployerHasAdmin ? "YES ❌" : "NO ✅",
  );
  console.log(
    "Deployer has MINTER_ROLE:",
    deployerHasMinter ? "YES ❌" : "NO ✅",
  );

  if (
    safeHasAdmin &&
    relayerHasMinter &&
    !deployerHasAdmin &&
    !deployerHasMinter
  ) {
    console.log("\n🎉 Role transfer completed successfully!");
    console.log(
      "\n⚠️  IMPORTANT: The deployer wallet no longer has any control over the token.",
    );
    console.log(
      "All future admin operations must be executed via the Gnosis Safe.",
    );
  } else {
    console.log(
      "\n⚠️  WARNING: Role verification failed. Check the output above.",
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
