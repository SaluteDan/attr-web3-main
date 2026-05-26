import hre from "hardhat";
import { getContract } from "viem";
import { MembershipTokenABI } from "../../src/index.js";

// ===== CONFIGURATION =====
const CONFIG = {
  contractAddress: "0x46dB81f355189E8C417e40c32478A95B6fDe9c1E",
  recipient: "0x02A13E6bfc25985381C3AB9e10977EEf6E558187",
  tier: 1,
  metadataURI: "ipfs://QmcF2TRBgR4gbQ37RNZfcZx6N9LKvnZQ4NMpvMt5FHYj3L",
  batchJsonFile: null as string | null,
};
// ========================

async function mintMembershipToken() {
  try {
    const connection = await hre.network.create();
    const [signer] = await connection.viem.getWalletClients();
    const publicClient = await connection.viem.getPublicClient();

    const membership = getContract({
      address: CONFIG.contractAddress as `0x${string}`,
      abi: MembershipTokenABI,
      client: { public: publicClient, wallet: signer },
    });

    if (CONFIG.batchJsonFile) {
      const fs = await import("fs");
      const config = JSON.parse(fs.readFileSync(CONFIG.batchJsonFile, "utf-8"));

      console.log(
        `🔄 Batch minting ${config.recipients.length} membership tokens...`,
      );

      // Type-safe contract call with autocomplete for method name and params
      const txHash = await membership.write.adminBatchMintMemberships([
        config.recipients,
        config.tiers,
        config.metadataURIs,
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      console.log(`✅ Batch mint successful!`);
      console.log(`   Transaction: ${receipt.transactionHash}`);
    } else {
      if (!CONFIG.recipient || !CONFIG.tier || !CONFIG.metadataURI) {
        console.error("❌ Missing required configuration for single mint");
        process.exit(1);
      }

      console.log(`🎫 Minting membership token...`);
      console.log(`   Contract: ${CONFIG.contractAddress}`);
      console.log(`   Recipient: ${CONFIG.recipient}`);
      console.log(`   Tier: ${CONFIG.tier}`);

      // Type-safe call - TypeScript knows this method exists and its parameter types
      const txHash = await membership.write.adminMintMembership([
        CONFIG.recipient as `0x${string}`,
        CONFIG.tier,
        CONFIG.metadataURI,
      ]);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      console.log(`✅ Mint successful!`);
      console.log(`   Transaction: ${receipt.transactionHash}`);
      console.log(`   Block: ${receipt.blockNumber}`);
    }
  } catch (error) {
    console.error("❌ Mint failed:", error);
    process.exit(1);
  }
}

mintMembershipToken();
