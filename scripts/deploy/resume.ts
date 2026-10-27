import hre from "hardhat";
import { formatEther, parseEther, isAddress, zeroAddress, getAddress, getContract } from "viem";
import * as dotenv from "dotenv";
import { ATTRSpenderABI } from "../../src/index.js";

dotenv.config();

/**
 * Resumes deployment on Base Sepolia from Step 5 onward:
 * - ATTRToken already deployed:          0x9005f817eb7aefb6a48f2c3a671ea1b4d3c71abe
 * - MembershipToken already deployed:    0x210eed1eda2a45bb12d40e7534484c43fa238544
 * - ATTROnboardingVault deployed:        0xb7f7dd6d2f425cabd9749c7b1a89aa056a92f188
 * - MockMembershipUSDC deployed:         0x5a2652ac5bc895fc7731147cac0596453ae13bd7
 * - configurePaymentTokens executed & verified!
 */
async function main() {
  console.log("════════════════════════════════════════════════════════════════");
  console.log("       🚀 ATTR PROTOCOL — RESUMING BASE SEPOLIA SETUP           ");
  console.log("════════════════════════════════════════════════════════════════\n");

  const connection = await hre.network.create();
  const [deployer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  const networkName = connection.networkName;
  console.log(`🌐 Network:          ${networkName}`);
  console.log(`👤 Deployer Account: ${deployer.account.address}`);

  const balance = await publicClient.getBalance({ address: deployer.account.address });
  console.log(`💰 Account Balance:  ${formatEther(balance)} ETH\n`);

  const attrTokenAddress = "0x9005f817eb7aefb6a48f2c3a671ea1b4d3c71abe" as `0x${string}`;
  const membershipTokenAddress = "0x210eed1eda2a45bb12d40e7534484c43fa238544" as `0x${string}`;
  const onboardingVaultAddress = "0xb7f7dd6d2f425cabd9749c7b1a89aa056a92f188" as `0x${string}`;
  const usdcAddress = "0x5a2652ac5bc895fc7731147cac0596453ae13bd7" as `0x${string}`;

  const envTreasury = process.env.PLATFORM_TREASURY_ADDRESS;
  const distributionAddress = (envTreasury || deployer.account.address) as `0x${string}`;
  const daoOwner = (process.env.DAO_MULTISIG_ADDRESS || envTreasury || deployer.account.address) as `0x${string}`;
  const paymentReceiver = (process.env.MEMBERSHIP_PAYMENT_RECEIVER || envTreasury || deployer.account.address) as `0x${string}`;
  const royaltyReceiver = (process.env.MEMBERSHIP_ROYALTY_RECEIVER || paymentReceiver) as `0x${string}`;
  const royaltyBps = BigInt(process.env.MEMBERSHIP_ROYALTY_BPS || "500");
  const contractURI = process.env.MEMBERSHIP_CONTRACT_URI || "ipfs://QmAttributesMembershipURI";
  const maxSupply = BigInt(process.env.MEMBERSHIP_MAX_SUPPLY || "50000");
  const maxMintPerWallet = BigInt(process.env.MEMBERSHIP_MAX_MINT_PER_WALLET || "2");

  const attrToken = await connection.viem.getContractAt("ATTRToken", attrTokenAddress);
  const membershipToken = await connection.viem.getContractAt("MembershipToken", membershipTokenAddress);
  const onboardingVault = await connection.viem.getContractAt("ATTROnboardingVault", onboardingVaultAddress);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 5: Fund ATTROnboardingVault with Welcome Grant Pool (150M ATTR)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 5/10: Funding ATTROnboardingVault (150M ATTR) ──────");
  const GRANT_POOL_AMOUNT = parseEther("150000000"); // 150M ATTR

  const currentVaultBal = await attrToken.read.balanceOf([onboardingVaultAddress]);
  console.log(`   Current Vault Balance: ${formatEther(currentVaultBal)} ATTR`);

  if (currentVaultBal >= GRANT_POOL_AMOUNT) {
    console.log("✅ ATTROnboardingVault is already fully funded!\n");
  } else {
    const deployerAttrBal = await attrToken.read.balanceOf([deployer.account.address]);
    console.log(`   Deployer ATTR Balance: ${formatEther(deployerAttrBal)} ATTR`);
    if (deployerAttrBal >= GRANT_POOL_AMOUNT) {
      console.log("   Transferring 150,000,000 ATTR from deployer to vault...");
      const fundTx = await attrToken.write.transfer([onboardingVaultAddress, GRANT_POOL_AMOUNT]);
      await publicClient.waitForTransactionReceipt({ hash: fundTx });
      const newVaultBal = await attrToken.read.balanceOf([onboardingVaultAddress]);
      console.log(`✅ ATTROnboardingVault funded: ${formatEther(newVaultBal)} ATTR\n`);
    } else {
      console.log(`⚠️  Deployer balance < 150M ATTR. Please transfer 150M ATTR from distribution address.`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Step 6: Deploy ATTRSpender
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 6/10: Deploying ATTRSpender ────────────────────────");
  const attrSpender = await connection.viem.deployContract("ATTRSpender", [
    attrTokenAddress,
    deployer.account.address,
  ]);
  console.log(`✅ ATTRSpender deployed to:         ${attrSpender.address}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 7: Deploy ATTRDeployer (Collection Factory)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 7/10: Deploying ATTRDeployer (Factory) ─────────────");
  const attrDeployer = await connection.viem.deployContract("ATTRDeployer", [
    deployer.account.address,
    attrSpender.address,
  ]);
  console.log(`✅ ATTRDeployer deployed to:        ${attrDeployer.address}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 8: Transfer ATTRSpender Ownership to ATTRDeployer
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 8/10: Transferring ATTRSpender Ownership to Factory ");
  const transferTx = await attrSpender.write.transferOwnership([attrDeployer.address]);
  await publicClient.waitForTransactionReceipt({ hash: transferTx });
  const spenderOwner = await attrSpender.read.owner();
  console.log(`✅ ATTRSpender owner verified as:   ${spenderOwner}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 9: Deploy VestingLockCampaignFactory
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 9/10: Deploying VestingLockCampaignFactory ─────────");
  const vestingFactory = await connection.viem.deployContract("VestingLockCampaignFactory", [daoOwner]);
  console.log(`✅ VestingLockCampaignFactory:      ${vestingFactory.address}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 10: Deploy MembershipFeeDistributor (Phase 2 Component)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 10/10: Deploying MembershipFeeDistributor (Phase 2) ");
  const feeDistributor = await connection.viem.deployContract("MembershipFeeDistributor", [
    membershipTokenAddress,
    daoOwner,
  ]);
  console.log(`✅ MembershipFeeDistributor:        ${feeDistributor.address}`);
  console.log(`   (Note: MembershipToken.feeDistributor remains address(0) until Phase 2)\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Summary
  // ───────────────────────────────────────────────────────────────────────────
  console.log("════════════════════════════════════════════════════════════════");
  console.log("🎉 ALL CONTRACTS DEPLOYED & WIRED ON BASE SEPOLIA!");
  console.log("════════════════════════════════════════════════════════════════\n");

  const summary = {
    network: networkName,
    chainId: await publicClient.getChainId(),
    deployer: deployer.account.address,
    contracts: {
      ATTRToken: attrTokenAddress,
      MembershipToken: membershipTokenAddress,
      ATTROnboardingVault: onboardingVaultAddress,
      USDC: usdcAddress,
      ATTRSpender: attrSpender.address,
      ATTRDeployer: attrDeployer.address,
      VestingLockCampaignFactory: vestingFactory.address,
      MembershipFeeDistributor: feeDistributor.address,
    },
  };

  console.table(summary.contracts);

  console.log("\n📝 ENVIRONMENT VARIABLES (.env snippet for Backend & Frontend):");
  console.log("----------------------------------------------------------------");
  console.log(`ATTR_TOKEN_ADDRESS=${attrTokenAddress}`);
  console.log(`MEMBERSHIP_TOKEN_CONTRACT=${membershipTokenAddress}`);
  console.log(`ATTR_ONBOARDING_VAULT_ADDRESS=${onboardingVaultAddress}`);
  console.log(`USDC_ADDRESS=${usdcAddress}`);
  console.log(`ATTR_SPENDER_CONTRACT=${attrSpender.address}`);
  console.log(`FACTORY_CONTRACT_ADDRESS=${attrDeployer.address}`);
  console.log(`VESTING_LOCK_CAMPAIGN_FACTORY_ADDRESS=${vestingFactory.address}`);
  console.log(`MEMBERSHIP_FEE_DISTRIBUTOR_ADDRESS=${feeDistributor.address}`);
  console.log(`PLATFORM_TREASURY_ADDRESS=${distributionAddress}`);
  console.log("----------------------------------------------------------------\n");

  console.log("🔍 BASESCAN VERIFICATION COMMANDS:");
  console.log("----------------------------------------------------------------");
  console.log(`npx hardhat verify --network baseSepolia ${attrTokenAddress} "${distributionAddress}"`);
  console.log(`npx hardhat verify --network baseSepolia ${membershipTokenAddress} "ATTR-MEMBER-ID" "ATTR#" "${deployer.account.address}" "${paymentReceiver}" "${royaltyReceiver}" ${royaltyBps} "${contractURI}" ${maxSupply} ${maxMintPerWallet}`);
  console.log(`npx hardhat verify --network baseSepolia ${onboardingVaultAddress} "${attrTokenAddress}" "${membershipTokenAddress}" "${daoOwner}"`);
  console.log(`npx hardhat verify --network baseSepolia ${attrSpender.address} "${attrTokenAddress}" "${deployer.account.address}"`);
  console.log(`npx hardhat verify --network baseSepolia ${attrDeployer.address} "${deployer.account.address}" "${attrSpender.address}"`);
  console.log(`npx hardhat verify --network baseSepolia ${vestingFactory.address} "${daoOwner}"`);
  console.log(`npx hardhat verify --network baseSepolia ${feeDistributor.address} "${membershipTokenAddress}" "${daoOwner}"`);
  console.log("----------------------------------------------------------------\n");
}

main().catch((err) => {
  console.error("❌ Execution failed:", err);
  process.exit(1);
});
