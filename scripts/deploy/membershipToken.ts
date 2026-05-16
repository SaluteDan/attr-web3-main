import { ethers } from "hardhat";

async function deployMembershipToken() {
  console.log("🚀 Deploying MembershipToken contract...");

  try {
    const [deployer] = await ethers.getSigners();
    const paymentReceiver = process.env.PAYMENT_RECEIVER || deployer.address;

    const Parameters = {
      name: "ATTR ID",
      symbol: "ATTR#",
      maxSupply: process.env.MEMBERSHIP_MAX_SUPPLY || "10000",
    };

    console.log(`📋 Deployment Parameters:`);
    console.log(`   Name: ${Parameters.name}`);
    console.log(`   Symbol: ${Parameters.symbol}`);
    console.log(`   Initial Owner: ${deployer.address}`);
    console.log(`   Payment Receiver: ${paymentReceiver}`);
    console.log(`   Max Supply: ${Parameters.maxSupply}`);
    console.log("");

    const MembershipToken = await ethers.getContractFactory("MembershipToken");
    const membership = await MembershipToken.deploy(
      Parameters.name,
      Parameters.symbol,
      deployer.address,
      paymentReceiver,
      BigInt(Parameters.maxSupply),
    );

    await membership.waitForDeployment();
    const contractAddress = await membership.getAddress();
    console.log("✅ MembershipToken deployed to:", contractAddress);
    console.log("");
    console.log("📝 Update your .env with:");
    console.log(`   MEMBERSHIP_TOKEN_CONTRACT=${contractAddress}`);
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }
}

deployMembershipToken();
