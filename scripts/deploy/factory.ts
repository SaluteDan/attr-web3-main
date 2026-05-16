import { ethers } from "hardhat";

/**
 * Deploy ATTRDeployer contract
 * Run with: npx hardhat run scripts/deploy-factory.ts --network baseSepolia
 */
async function main() {
  console.log("Deploying ATTRDeployer...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Get account balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Deploy Factory
  const Factory = await ethers.getContractFactory("ATTRDeployer");
  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  console.log("ATTRDeployer deployed to:", factoryAddress);

  // Save deployment info
  console.log("\n=== Deployment Complete ===");
  console.log("Add this to your .env file:");
  console.log(`FACTORY_CONTRACT_ADDRESS=${factoryAddress}`);
  console.log(`DEPLOYER_ADDRESS=${deployer.address}`);
  console.log("\nVerify on BaseScan:");
  console.log(`https://sepolia.basescan.org/address/${factoryAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
