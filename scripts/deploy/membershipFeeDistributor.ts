import hre from "hardhat";
import { formatEther, isAddress } from "viem";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Deploy MembershipFeeDistributor contract
 * Run with: npx hardhat run scripts/deploy/membershipFeeDistributor.ts --network baseSepolia
 *
 * Prerequisites:
 * - MEMBERSHIP_TOKEN_ADDRESS must be set in .env (deploy membershipToken.ts first)
 *
 * This contract distributes LP fees to MembershipToken holders pro-rata.
 * - DAO multisig is the owner (controls deposits and snapshot updates)
 * - LP fees flow: DEX -> Treasury (50%) -> this distributor (50%) -> holders
 */
async function main() {
  console.log("🚀 Deploying MembershipFeeDistributor...");

  const connection = await hre.network.create();
  const [deployer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  console.log("Deploying with account:", deployer.account.address);

  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH");

  // Configuration
  // Validate membershipTokenAddress format
  const membershipTokenAddress = process.env.MEMBERSHIP_TOKEN_ADDRESS;
  if (!membershipTokenAddress) {
    console.error("❌ MEMBERSHIP_TOKEN_ADDRESS not set in .env");
    console.log(
      "Deploy MembershipToken first: npx hardhat run scripts/deploy/membershipToken.ts --network baseSepolia",
    );
    process.exit(1);
  }
  if (!isAddress(membershipTokenAddress)) {
    console.error(
      "❌ MEMBERSHIP_TOKEN_ADDRESS is not a valid Ethereum address",
    );
    process.exit(1);
  }

  const daoOwner = (process.env.DAO_MULTISIG_ADDRESS ||
    deployer.account.address) as `0x${string}`;

  console.log("\n📋 Deployment Parameters:");
  console.log(`   Membership Token: ${membershipTokenAddress}`);
  console.log(`   DAO Owner: ${daoOwner}`);
  console.log(
    "\n⚠️  IMPORTANT: DAO must call setTotalMintedSnapshot() after deployment!",
  );
  console.log("   Deposits are blocked until snapshot is set.");

  // Deploy MembershipFeeDistributor
  const distributor = await connection.viem.deployContract(
    "MembershipFeeDistributor",
    [membershipTokenAddress as `0x${string}`, daoOwner],
  );

  const distributorAddress = distributor.address;
  console.log("\n✅ MembershipFeeDistributor deployed to:", distributorAddress);

  console.log("\n=== Deployment Complete ===");
  console.log("Add this to your .env file:");
  console.log(`MEMBERSHIP_FEE_DISTRIBUTOR_ADDRESS=${distributorAddress}`);
  console.log("\nNext steps (DAO must execute):");
  console.log("1. Call setTotalMintedSnapshot(totalSupply) to enable deposits");
  console.log(
    "2. LP fee split: 50% Treasury, 50% deposited to this distributor",
  );
  console.log(
    "3. Holders call claimETH([tokenIds]) or claimERC20(token, [tokenIds])",
  );
  console.log("\nVerify on BaseScan:");
  console.log(
    `npx hardhat verify --network baseSepolia ${distributorAddress} ${membershipTokenAddress} ${daoOwner}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
