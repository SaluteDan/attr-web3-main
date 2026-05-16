import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Check account balance on the current network
 * Run with: npx hardhat run scripts/check-balance.ts --network baseSepolia
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("\n=== Account Balance Check ===");
  console.log("Network:", network.name, `(Chain ID: ${network.chainId})`);
  console.log("Account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  const balanceEth = ethers.formatEther(balance);

  console.log("Balance:", balanceEth, "ETH");
  console.log("Balance (wei):", balance.toString());

  // Estimate gas for deployments
  const estimatedGas = {
    ATTRToken: 1_200_000n,
    ATTRDeployer: 800_000n,
    GovernanceNFT: 2_500_000n,
    MembershipToken: 2_200_000n,
  };

  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice || 1n;
  const gasPriceGwei = ethers.formatUnits(gasPrice, "gwei");

  console.log("\n=== Gas Price Info ===");
  console.log("Current Gas Price:", gasPriceGwei, "gwei");

  console.log("\n=== Estimated Deployment Costs ===");
  let totalGas = 0n;
  for (const [contract, gas] of Object.entries(estimatedGas)) {
    const cost = gas * gasPrice;
    const costEth = ethers.formatEther(cost);
    console.log(`${contract}: ${gas.toLocaleString()} gas ≈ ${costEth} ETH`);
    totalGas += gas;
  }

  const totalCost = totalGas * gasPrice;
  const totalCostEth = ethers.formatEther(totalCost);
  console.log(
    `\nTotal: ${totalGas.toLocaleString()} gas ≈ ${totalCostEth} ETH`,
  );

  // Check if balance is sufficient
  console.log("\n=== Sufficiency Check ===");
  if (balance > totalCost) {
    console.log("✅ Balance is sufficient for deployment");
  } else {
    const needed = totalCost - balance;
    const neededEth = ethers.formatEther(needed);
    console.log(`❌ Insufficient balance. Need ${neededEth} more ETH`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
