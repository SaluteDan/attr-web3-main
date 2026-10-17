import hre from "hardhat";
import {
  formatEther,
  parseEther,
  isAddress,
  zeroAddress,
  getAddress,
} from "viem";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * All-in-One Deployment & Wiring Script for ATTR Protocol
 *
 * Deploys the complete smart contract suite in exact dependency order:
 *  1. ATTRToken (1B pre-minted fixed supply)
 *  2. MembershipToken (ERC-721 tiered memberships, 50k max cap)
 *  3. ATTROnboardingVault (Autonomous welcome-grant escrow)
 *  4. Configure MembershipToken with OnboardingVault & USDC
 *  5. Fund ATTROnboardingVault with the 150M ATTR welcome-grant pool
 *  6. ATTRSpender (Payment proxy for collection mints)
 *  7. ATTRDeployer (Collection factory; auto-authorizes collections)
 *  8. Transfer ATTRSpender ownership to ATTRDeployer
 *  9. VestingLockCampaignFactory (Community lock-to-earn staking campaigns)
 * 10. MembershipFeeDistributor (Phase 2 Platform Volume Share; Day-1 deferred)
 *
 * Usage:
 *   npx hardhat run scripts/deploy/all.ts --network baseSepolia
 *   npx hardhat run scripts/deploy/all.ts --network baseMainnet
 */
async function main() {
  console.log("════════════════════════════════════════════════════════════════");
  console.log("       🚀 ATTR PROTOCOL — UNIFIED DEPLOYMENT & SETUP           ");
  console.log("════════════════════════════════════════════════════════════════\n");

  const connection = await hre.network.create();
  const [deployer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  const networkName = connection.networkName;
  const isLocal =
    networkName === "default" ||
    networkName === "hardhat" ||
    networkName === "localhost";

  console.log(`🌐 Network:          ${networkName}`);
  console.log(`👤 Deployer Account: ${deployer.account.address}`);

  const balance = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log(`💰 Account Balance:  ${formatEther(balance)} ETH\n`);

  if (balance === 0n && !isLocal) {
    throw new Error(
      "❌ Deployer account has 0 ETH. Please fund the wallet before deploying.",
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Configuration & Parameter Resolution
  // ───────────────────────────────────────────────────────────────────────────

  // Distribution address receives the initial 1B ATTR supply.
  // For an automated all-in-one setup run:
  // - If MINT_DIRECT_TO_TREASURY=true and PLATFORM_TREASURY_ADDRESS is set, mints directly to treasury.
  // - Otherwise (default for setup ceremony), mints to deployer so the script can immediately fund
  //   the ATTROnboardingVault (150M) and forward the remaining 850M to PLATFORM_TREASURY_ADDRESS.
  const envTreasury = process.env.PLATFORM_TREASURY_ADDRESS;
  const mintDirectToTreasury =
    process.env.MINT_DIRECT_TO_TREASURY === "true" && !!envTreasury;

  const distributionAddress = (mintDirectToTreasury
    ? envTreasury
    : deployer.account.address) as `0x${string}`;

  const daoOwner = (process.env.DAO_MULTISIG_ADDRESS ||
    envTreasury ||
    deployer.account.address) as `0x${string}`;

  const paymentReceiver = (process.env.MEMBERSHIP_PAYMENT_RECEIVER ||
    envTreasury ||
    deployer.account.address) as `0x${string}`;

  const royaltyReceiver = (process.env.MEMBERSHIP_ROYALTY_RECEIVER ||
    paymentReceiver) as `0x${string}`;

  const royaltyBps = BigInt(process.env.MEMBERSHIP_ROYALTY_BPS || "500"); // 5%
  const contractURI =
    process.env.MEMBERSHIP_CONTRACT_URI || "ipfs://QmAttributesMembershipURI";
  const maxSupply = BigInt(process.env.MEMBERSHIP_MAX_SUPPLY || "50000");
  const maxMintPerWallet = BigInt(
    process.env.MEMBERSHIP_MAX_MINT_PER_WALLET || "2",
  );

  console.log("📋 Configuration Parameters:");
  console.log(`   Distribution Address: ${distributionAddress}`);
  console.log(`   DAO / Timelock Owner: ${daoOwner}`);
  console.log(`   Payment Receiver:     ${paymentReceiver}`);
  console.log(`   Royalty Receiver:     ${royaltyReceiver} (${royaltyBps} bps)`);
  console.log(`   Max Membership Cap:   ${maxSupply}`);
  console.log(`   Max Mint Per Wallet:  ${maxMintPerWallet}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 1: Deploy ATTRToken ($ATTR)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 1/10: Deploying ATTRToken ($ATTR) ──────────────────");
  const attrToken = await connection.viem.deployContract("ATTRToken", [
    distributionAddress,
  ]);
  console.log(`✅ ATTRToken deployed to:          ${attrToken.address}`);
  console.log(`   Supply: 1,000,000,000 ATTR minted to ${distributionAddress}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 2: Deploy MembershipToken (ATTR-MEMBER-ID)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 2/10: Deploying MembershipToken (ERC-721) ──────────");
  const membershipToken = await connection.viem.deployContract(
    "MembershipToken",
    [
      "ATTR-MEMBER-ID",
      "ATTR#",
      deployer.account.address,
      paymentReceiver,
      royaltyReceiver,
      royaltyBps,
      contractURI,
      maxSupply,
      maxMintPerWallet,
    ],
  );
  console.log(`✅ MembershipToken deployed to:    ${membershipToken.address}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 3: Deploy ATTROnboardingVault
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 3/10: Deploying ATTROnboardingVault ────────────────");
  // We pass membershipToken.address directly so membershipToken is bound in the constructor
  const onboardingVault = await connection.viem.deployContract(
    "ATTROnboardingVault",
    [attrToken.address, membershipToken.address, daoOwner],
  );
  console.log(`✅ ATTROnboardingVault deployed to: ${onboardingVault.address}`);
  console.log(`   Authorized MembershipToken:     ${membershipToken.address}`);
  console.log(`   Vault Owner (DAO Timelock):     ${daoOwner}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 4: Configure MembershipToken Payment Tokens (Vault + USDC)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 4/10: Configuring MembershipToken Payment Tokens ───");
  let usdcAddress: `0x${string}`;

  // Chain ID check for Base Mainnet (8453) vs Sepolia / Local
  const chainId = await publicClient.getChainId();
  if (chainId === 8453) {
    usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Canonical Base native USDC
    console.log(`   Using Base Mainnet Native USDC: ${usdcAddress}`);
  } else if (process.env.USDC_ADDRESS && isAddress(process.env.USDC_ADDRESS)) {
    usdcAddress = getAddress(process.env.USDC_ADDRESS);
    console.log(`   Using configured USDC address:  ${usdcAddress}`);
  } else {
    console.log("   Deploying MockMembershipUSDC for testnet/local checkout...");
    const mockUsdc = await connection.viem.deployContract(
      "MockMembershipUSDC",
      [],
    );
    usdcAddress = mockUsdc.address;
    console.log(`   MockMembershipUSDC deployed to: ${usdcAddress}`);
  }

  const configTx = await membershipToken.write.configurePaymentTokens([
    onboardingVault.address,
    usdcAddress,
  ]);
  await publicClient.waitForTransactionReceipt({ hash: configTx });
  console.log("✅ MembershipToken configured with OnboardingVault & USDC\n");

  // ───────────────────────────────────────────────────────────────────────────
  // Step 5: Fund ATTROnboardingVault with Welcome Grant Pool
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 5/10: Funding ATTROnboardingVault ──────────────────");
  const GRANT_POOL_AMOUNT = parseEther("150000000"); // 150,000,000 ATTR (15%)

  const deployerAttrBal = await attrToken.read.balanceOf([
    deployer.account.address,
  ]);
  if (deployerAttrBal >= GRANT_POOL_AMOUNT) {
    console.log("   Deployer holds initial ATTR allocation. Funding vault directly...");
    const fundTx = await attrToken.write.transfer([
      onboardingVault.address,
      GRANT_POOL_AMOUNT,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: fundTx });

    const vaultBal = await attrToken.read.balanceOf([onboardingVault.address]);
    console.log(
      `✅ ATTROnboardingVault funded:      ${formatEther(vaultBal)} ATTR`,
    );

    // If an external treasury was designated, forward the remaining 850M ATTR to it
    if (
      envTreasury &&
      getAddress(envTreasury) !== getAddress(deployer.account.address)
    ) {
      const remainingBal = await attrToken.read.balanceOf([
        deployer.account.address,
      ]);
      if (remainingBal > 0n) {
        console.log(
          `   Forwarding remaining ${formatEther(remainingBal)} ATTR to treasury: ${envTreasury}...`,
        );
        const forwardTx = await attrToken.write.transfer([
          envTreasury as `0x${string}`,
          remainingBal,
        ]);
        await publicClient.waitForTransactionReceipt({ hash: forwardTx });
        console.log(
          `✅ Treasury forwarded:             ${formatEther(remainingBal)} ATTR to ${envTreasury}\n`,
        );
      }
    } else {
      console.log("");
    }
  } else {
    console.log(
      `⚠️  Deployer balance (${formatEther(deployerAttrBal)} ATTR) < 150M ATTR.`,
    );
    console.log(
      `   Distribution address (${distributionAddress}) must execute a transfer:`,
    );
    console.log(
      `   attrToken.transfer("${onboardingVault.address}", 150000000 ether)\n`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Step 6: Deploy ATTRSpender
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 6/10: Deploying ATTRSpender ────────────────────────");
  const attrSpender = await connection.viem.deployContract("ATTRSpender", [
    attrToken.address,
    deployer.account.address, // Initial owner: deployer (transferred to factory in Step 8)
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
  const transferTx = await attrSpender.write.transferOwnership([
    attrDeployer.address,
  ]);
  await publicClient.waitForTransactionReceipt({ hash: transferTx });

  const spenderOwner = await attrSpender.read.owner();
  if (spenderOwner.toLowerCase() === attrDeployer.address.toLowerCase()) {
    console.log(
      `✅ ATTRSpender ownership successfully transferred to ATTRDeployer!`,
    );
    console.log(
      `   Factory can now auto-authorize collections for ATTR payments.\n`,
    );
  } else {
    console.log(
      `⚠️  Ownership check mismatch. Current owner is: ${spenderOwner}\n`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Step 9: Deploy VestingLockCampaignFactory
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 9/10: Deploying VestingLockCampaignFactory ─────────");
  const vestingFactory = await connection.viem.deployContract(
    "VestingLockCampaignFactory",
    [daoOwner],
  );
  console.log(`✅ VestingLockCampaignFactory:      ${vestingFactory.address}\n`);

  // ───────────────────────────────────────────────────────────────────────────
  // Step 10: Deploy MembershipFeeDistributor (Phase 2 Platform Volume Share)
  // ───────────────────────────────────────────────────────────────────────────
  console.log("─── Step 10/10: Deploying MembershipFeeDistributor (Phase 2) ");
  const feeDistributor = await connection.viem.deployContract(
    "MembershipFeeDistributor",
    [membershipToken.address, daoOwner],
  );
  console.log(`✅ MembershipFeeDistributor:        ${feeDistributor.address}`);
  console.log(
    `   (Phase 2 Note: MembershipToken.feeDistributor remains address(0) until Phase 2 activation)\n`,
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Summary & Export Artifacts
  // ───────────────────────────────────────────────────────────────────────────
  console.log("════════════════════════════════════════════════════════════════");
  console.log("🎉 ALL CONTRACTS DEPLOYED & WIRED SUCCESSFULLY!");
  console.log("════════════════════════════════════════════════════════════════\n");

  const summary = {
    network: networkName,
    chainId,
    deployer: deployer.account.address,
    contracts: {
      ATTRToken: attrToken.address,
      MembershipToken: membershipToken.address,
      ATTROnboardingVault: onboardingVault.address,
      USDC: usdcAddress,
      ATTRSpender: attrSpender.address,
      ATTRDeployer: attrDeployer.address,
      VestingLockCampaignFactory: vestingFactory.address,
      MembershipFeeDistributor: feeDistributor.address,
    },
  };

  console.log("📋 DEPLOYED ADDRESSES SUMMARY:");
  console.table(summary.contracts);

  console.log("\n📝 ENVIRONMENT VARIABLES (.env snippet for Backend & Frontend):");
  console.log("----------------------------------------------------------------");
  console.log(`ATTR_TOKEN_ADDRESS=${attrToken.address}`);
  console.log(`MEMBERSHIP_TOKEN_CONTRACT=${membershipToken.address}`);
  console.log(`ATTR_ONBOARDING_VAULT_ADDRESS=${onboardingVault.address}`);
  console.log(`USDC_ADDRESS=${usdcAddress}`);
  console.log(`ATTR_SPENDER_CONTRACT=${attrSpender.address}`);
  console.log(`FACTORY_CONTRACT_ADDRESS=${attrDeployer.address}`);
  console.log(`VESTING_LOCK_CAMPAIGN_FACTORY_ADDRESS=${vestingFactory.address}`);
  console.log(`MEMBERSHIP_FEE_DISTRIBUTOR_ADDRESS=${feeDistributor.address}`);
  console.log(`PLATFORM_TREASURY_ADDRESS=${distributionAddress}`);
  console.log("----------------------------------------------------------------\n");

  console.log("🔍 BASESCAN VERIFICATION COMMANDS:");
  console.log("----------------------------------------------------------------");
  console.log(
    `npx hardhat verify --network ${networkName} ${attrToken.address} "${distributionAddress}"`,
  );
  console.log(
    `npx hardhat verify --network ${networkName} ${membershipToken.address} "ATTR-MEMBER-ID" "ATTR#" "${deployer.account.address}" "${paymentReceiver}" "${royaltyReceiver}" ${royaltyBps} "${contractURI}" ${maxSupply} ${maxMintPerWallet}`,
  );
  console.log(
    `npx hardhat verify --network ${networkName} ${onboardingVault.address} "${attrToken.address}" "${membershipToken.address}" "${daoOwner}"`,
  );
  console.log(
    `npx hardhat verify --network ${networkName} ${attrSpender.address} "${attrToken.address}" "${deployer.account.address}"`,
  );
  console.log(
    `npx hardhat verify --network ${networkName} ${attrDeployer.address} "${deployer.account.address}" "${attrSpender.address}"`,
  );
  console.log(
    `npx hardhat verify --network ${networkName} ${vestingFactory.address} "${daoOwner}"`,
  );
  console.log(
    `npx hardhat verify --network ${networkName} ${feeDistributor.address} "${membershipToken.address}" "${daoOwner}"`,
  );
  console.log("----------------------------------------------------------------\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
