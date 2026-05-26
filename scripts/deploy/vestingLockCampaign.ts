import hre from "hardhat";
import {
  decodeEventLog,
  formatEther,
  parseEther,
  type DecodeEventLogReturnType,
} from "viem";
import { baseSepolia, base } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Deploy VestingLockCampaign via factory
 * Run with: npx hardhat run scripts/deploy/vestingLockCampaign.ts --network baseSepolia
 *
 * Prerequisites:
 * - VESTING_LOCK_CAMPAIGN_FACTORY_ADDRESS must be set in .env
 * - ATTR_TOKEN_ADDRESS must be set in .env
 * - Caller must be the factory owner
 */
async function main() {
  console.log("🚀 Deploying VestingLockCampaign via factory...");

  const connection = await hre.network.create();
  const [deployer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  console.log("Deploying with account:", deployer.account.address);

  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log("Account balance:", formatEther(balance), "ETH");

  const factoryAddress = "0xae01e9d9c5f5333b09bdb5b0aa923b85735d6824";
  if (!factoryAddress) {
    console.error("❌ VESTING_LOCK_CAMPAIGN_FACTORY_ADDRESS not set in .env");
    console.log(
      "Deploy factory first: npx hardhat run scripts/deploy/vestingFactory.ts --network baseSepolia",
    );
    process.exit(1);
  }

  const attrTokenAddress = process.env.ATTR_TOKEN_ADDRESS;
  if (!attrTokenAddress) {
    console.error("❌ ATTR_TOKEN_ADDRESS not set in .env");
    console.log(
      "Deploy ATTRToken first: npx hardhat run scripts/deploy/token.ts --network baseSepolia",
    );
    process.exit(1);
  }

  // Campaign configuration - adjust these values as needed
  const campaignConfig = {
    stakingToken: attrTokenAddress, // Token users lock
    allowEarlyWithdraw: true, // Allow early withdrawal (forfeits rewards)
    rewardToken: attrTokenAddress, // Token paid as rewards
    minLockAmount: parseEther("2500"), // Minimum 100 ATTR to participate
    lockPeriod: 600, // 30 days in seconds
    rewardAmount: parseEther("5000"), // 50 ATTR reward per participant
    campaignStart: Math.floor(Date.now() / 1000), // Starts now
    campaignEnd: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // Ends in 7 days
    maxParticipants: 100n, // Max 100 participants (0 for uncapped)
  };

  console.log("\n📋 Factory Address:", factoryAddress);
  console.log("📋 Campaign Parameters:");
  console.log(`   Staking Token: ${campaignConfig.stakingToken}`);
  console.log(`   Reward Token: ${campaignConfig.rewardToken}`);
  console.log(`   Min Lock Amount: 100 ATTR`);
  console.log(`   Lock Period: 30 days`);
  console.log(`   Reward Amount: 50 ATTR`);
  console.log(`   Campaign Duration: 7 days`);
  console.log(`   Max Participants: ${campaignConfig.maxParticipants}`);
  console.log(`   Allow Early Withdraw: ${campaignConfig.allowEarlyWithdraw}`);

  const hash = await deployer.writeContract({
    address: factoryAddress as `0x${string}`,
    abi: (await hre.artifacts.readArtifact("VestingLockCampaignFactory")).abi,
    functionName: "createCampaign",
    args: [campaignConfig],
  });

  console.log("\n⏳ Transaction sent:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("✅ Transaction confirmed in block:", receipt.blockNumber);

  // Parse event to get campaign address
  const factoryAbi = (
    await hre.artifacts.readArtifact("VestingLockCampaignFactory")
  ).abi;
  const decodedLogs: DecodeEventLogReturnType<typeof factoryAbi>[] =
    receipt.logs
      .map((log: any) => {
        try {
          return decodeEventLog({
            abi: factoryAbi,
            data: log.data,
            topics: log.topics,
          });
        } catch {
          return null;
        }
      })
      .filter(
        (log): log is DecodeEventLogReturnType<typeof factoryAbi> =>
          log !== null,
      );

  const campaignEvent = decodedLogs.find(
    (log) => log.eventName === "CampaignDeployed",
  );
  if (!campaignEvent) {
    throw new Error("CampaignDeployed event not found in transaction receipt");
  }
  const campaignAddress = (
    campaignEvent.args as unknown as { campaign: string }
  ).campaign;

  console.log("\n✅ VestingLockCampaign deployed to:", campaignAddress);

  const campaignCount = await publicClient.readContract({
    address: factoryAddress as `0x${string}`,
    abi: factoryAbi,
    functionName: "getCampaignCount",
  });
  console.log(`📊 Total campaigns in factory: ${campaignCount}`);

  const rewardAmount =
    campaignConfig.maxParticipants * campaignConfig.rewardAmount;

  console.log("\n=== Deployment Complete ===");
  console.log("Add this to your .env file:");
  console.log(`VESTING_LOCK_CAMPAIGN=${campaignAddress}`);
  console.log("\n📋 Funding Required:");
  console.log(
    `   Transfer ${formatEther(rewardAmount)} ATTR to: ${campaignAddress}`,
  );
  console.log("\nNext steps:");
  console.log(
    "1. Transfer ATTR to the campaign contract (any amount >= reward pool)",
  );
  console.log("2. Users can lock tokens during campaign period");
  console.log("3. After lock period, users claim rewards");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
