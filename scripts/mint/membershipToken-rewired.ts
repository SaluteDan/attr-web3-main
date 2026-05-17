import { ethers } from "hardhat";
import {
  MembershipToken,
  MembershipToken__factory,
} from "../../src/index";

interface MintConfig {
  contractAddress: string;
  recipients: string[];
  tiers: number[];
  metadataURIs: string[];
  isBatch?: boolean;
}

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
  const args = process.argv.slice(2);

  try {
    const [signer] = await ethers.getSigners();

    // Rewired: Use factory class for type-safe contract attachment
    const membership = MembershipToken__factory.connect(
      CONFIG.contractAddress,
      signer
    ) as MembershipToken;

    if (CONFIG.batchJsonFile) {
      const fs = await import("fs");
      const config = JSON.parse(fs.readFileSync(CONFIG.batchJsonFile, "utf-8"));

      console.log(
        `🔄 Batch minting ${config.recipients.length} membership tokens...`
      );

      // Type-safe contract call with autocomplete for method name and params
      const tx = await membership.adminBatchMintMemberships(
        config.recipients,
        config.tiers,
        config.metadataURIs
      );

      const receipt = await tx.wait();
      console.log(`✅ Batch mint successful!`);
      console.log(`   Transaction: ${receipt?.transactionHash}`);
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
      const tx = await membership.adminMintMembership(
        CONFIG.recipient,
        CONFIG.tier,
        CONFIG.metadataURI
      );
      const receipt = await tx.wait();

      console.log(`✅ Mint successful!`);
      console.log(`   Transaction: ${receipt?.transactionHash}`);
    }
  } catch (error) {
    console.error("❌ Mint failed:", error);
    process.exit(1);
  }
}

mintMembershipToken();
