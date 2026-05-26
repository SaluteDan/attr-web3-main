import hre from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function deployMembershipToken() {
  console.log("🚀 Deploying MembershipToken (ATTR-MEMBER-ID) contract...");

  try {
    const connection = await hre.network.create();
    const [deployer] = await connection.viem.getWalletClients();

    const params = {
      name: "ATTR-MEMBER-ID",
      symbol: "ATTR#",
      initialOwner: deployer.account.address,
      paymentReceiver:
        process.env.MEMBERSHIP_PAYMENT_RECEIVER || deployer.account.address,
      royaltyReceiver:
        process.env.MEMBERSHIP_ROYALTY_RECEIVER || deployer.account.address,
      royaltyFeeBps: process.env.MEMBERSHIP_ROYALTY_BPS || "500", // 5%
      contractURI:
        process.env.MEMBERSHIP_CONTRACT_URI || "ipfs://QmYourMetadataHash",
      maxSupply: process.env.MEMBERSHIP_MAX_SUPPLY || "50000",
      maxMintPerWallet: process.env.MEMBERSHIP_MAX_MINT_PER_WALLET || "5",
    };

    console.log(`📋 Deployment Parameters:`);
    console.log(`   Name:              ${params.name}`);
    console.log(`   Symbol:            ${params.symbol}`);
    console.log(`   Initial Owner:     ${params.initialOwner}`);
    console.log(`   Payment Receiver:  ${params.paymentReceiver}`);
    console.log(`   Royalty Receiver:  ${params.royaltyReceiver}`);
    console.log(`   Royalty Fee (bps): ${params.royaltyFeeBps}`);
    console.log(`   Max Supply:        ${params.maxSupply}`);
    console.log(`   Max Mint/Wallet:   ${params.maxMintPerWallet}`);
    console.log("");

    const membership = await connection.viem.deployContract("MembershipToken", [
      params.name,
      params.symbol,
      params.initialOwner as `0x${string}`,
      params.paymentReceiver as `0x${string}`,
      params.royaltyReceiver as `0x${string}`,
      BigInt(params.royaltyFeeBps),
      params.contractURI,
      BigInt(params.maxSupply),
      BigInt(params.maxMintPerWallet),
    ]);

    const contractAddress = membership.address;
    console.log("✅ MembershipToken deployed to:", contractAddress);
    console.log("");
    console.log("📝 Update your .env with:");
    console.log(`   MEMBERSHIP_TOKEN_CONTRACT=${contractAddress}`);
    console.log(`\nVerify with:`);
    console.log(
      `npx hardhat verify --network baseSepolia ${contractAddress}` +
        ` "${params.name}" "${params.symbol}" "${params.initialOwner}"` +
        ` "${params.paymentReceiver}" "${params.royaltyReceiver}"` +
        ` ${params.royaltyFeeBps} "${params.contractURI}"` +
        ` ${params.maxSupply} ${params.maxMintPerWallet}`,
    );
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }
}

deployMembershipToken();
