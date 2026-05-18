#!/usr/bin/env node
/**
 * Check ATTRSpender Address Script
 *
 * This script checks which address is set as the ATTRSpender in NFTCollection
 * and ATTRDeployer contracts. Useful for verifying the payment routing setup.
 *
 * Usage:
 *   npx hardhat run scripts/check/attr-spender.ts --network baseSepolia
 *   npx hardhat run scripts/check/attr-spender.ts --network baseMainnet
 */

import { createPublicClient, http } from "viem";
import { baseSepolia, base } from "viem/chains";
import * as dotenv from "dotenv";
import {
  NFTCollectionABI,
  ATTRDeployerABI,
} from "../../src/index.js";

dotenv.config();

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function main() {
  // Determine network from environment or default to baseSepolia
  const networkName = process.env.HARDHAT_NETWORK || "baseSepolia";
  const chain = networkName === "baseMainnet" ? base : baseSepolia;
  const rpcUrl = networkName === "baseMainnet"
    ? process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org"
    : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

  console.log(`\n🔍 Checking ATTRSpender addresses on ${chain.name}...\n`);

  // Get contract addresses from environment
  const factoryAddress = process.env.FACTORY_CONTRACT_ADDRESS;
  const collectionAddress = process.env.COLLECTION_CONTRACT_ADDRESS; // Optional: specific collection

  if (!factoryAddress) {
    console.error("❌ FACTORY_CONTRACT_ADDRESS not set in environment");
    console.log("   Set it with: export FACTORY_CONTRACT_ADDRESS=0x...");
    process.exit(1);
  }

  // Create public client
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  // Check ATTRDeployer factory
  console.log("📋 ATTRDeployer Factory:");
  console.log(`   Address: ${factoryAddress}`);
  try {
    const attrTokenAddress = await publicClient.readContract({
      address: factoryAddress as `0x${string}`,
      abi: ATTRDeployerABI,
      functionName: "attrToken",
    });
    console.log(`   ATTR Token: ${attrTokenAddress}`);

    const attrSpenderAddress = await publicClient.readContract({
      address: factoryAddress as `0x${string}`,
      abi: ATTRDeployerABI,
      functionName: "attrSpender",
    });

    if (attrSpenderAddress === ZERO_ADDRESS) {
      console.log(`   ⚠️  ATTRSpender: NOT SET (zero address)`);
      console.log(`      → New collections will use collection address for approvals`);
    } else {
      console.log(`   ✅ ATTRSpender: ${attrSpenderAddress}`);
      console.log(`      → New collections will use this address for approvals`);
    }
  } catch (error: any) {
    console.error(`   ❌ Error reading factory: ${error.message}`);
  }

  // Check specific collection if address provided
  if (collectionAddress) {
    console.log(`\n📋 NFTCollection:`);
    console.log(`   Address: ${collectionAddress}`);
    try {
      const attrSpenderAddress = await publicClient.readContract({
        address: collectionAddress as `0x${string}`,
        abi: NFTCollectionABI,
        functionName: "attrSpender",
      });

      if (attrSpenderAddress === ZERO_ADDRESS) {
        console.log(`   ⚠️  ATTRSpender: NOT SET (zero address)`);
        console.log(`      → Token approvals should target: collection address`);
      } else {
        console.log(`   ✅ ATTRSpender: ${attrSpenderAddress}`);
        console.log(`      → Token approvals should target: ATTRSpender address`);
      }

      // Additional info
      const currency = await publicClient.readContract({
        address: collectionAddress as `0x${string}`,
        abi: NFTCollectionABI,
        functionName: "currency",
      });
      console.log(`   Currency: ${currency}`);

      const paymentReceiver = await publicClient.readContract({
        address: collectionAddress as `0x${string}`,
        abi: NFTCollectionABI,
        functionName: "paymentReceiver",
      });
      console.log(`   Payment Receiver: ${paymentReceiver}`);
    } catch (error: any) {
      console.error(`   ❌ Error reading collection: ${error.message}`);
    }
  }

  // Summary
  console.log("\n📊 Summary:");
  console.log("   The ATTRSpender contract handles token approvals for minting.");
  console.log("   If set, users approve the ATTRSpender, not the collection.");
  console.log("   This enables more flexible payment routing.");
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
