import { createPublicClient, http, formatEther, formatUnits } from "viem";
import { baseSepolia, base } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Check account balance on the current network
 * Run with: npx tsx scripts/check/balance.ts
 */
async function main() {
  // Determine network from environment or default to baseSepolia
  const networkName = process.env.HARDHAT_NETWORK || "baseSepolia";
  const chain = networkName === "baseMainnet" ? base : baseSepolia;
  const rpcUrl = networkName === "baseMainnet"
    ? process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org"
    : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

  // Get account from environment or use a default
  const account = (process.env.DEPLOYER_ADDRESS || process.env.PRIVATE_KEY) as `0x${string}` | undefined;
  if (!account) {
    console.error("❌ DEPLOYER_ADDRESS or PRIVATE_KEY not set in environment");
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  console.log("\n=== Account Balance Check ===");
  console.log("Network:", chain.name, `(Chain ID: ${chain.id})`);
  console.log("Account:", account);

  const balance = await publicClient.getBalance({ address: account });
  const balanceEth = formatEther(balance);

  console.log("Balance:", balanceEth, "ETH");
  console.log("Balance (wei):", balance.toString());

  // Estimate gas for deployments
  const estimatedGas = {
    ATTRToken: 1_200_000n,
    ATTRDeployer: 800_000n,
    GovernanceNFT: 2_500_000n,
    MembershipToken: 2_200_000n,
  };

  const gasPrice = await publicClient.getGasPrice();
  const gasPriceGwei = formatUnits(gasPrice, 9);

  console.log("\n=== Gas Price Info ===");
  console.log("Current Gas Price:", gasPriceGwei, "gwei");

  console.log("\n=== Estimated Deployment Costs ===");
  let totalGas = 0n;
  for (const [contract, gas] of Object.entries(estimatedGas)) {
    const cost = gas * gasPrice;
    const costEth = formatEther(cost);
    console.log(`${contract}: ${gas.toLocaleString()} gas ≈ ${costEth} ETH`);
    totalGas += gas;
  }

  const totalCost = totalGas * gasPrice;
  const totalCostEth = formatEther(totalCost);
  console.log(
    `\nTotal: ${totalGas.toLocaleString()} gas ≈ ${totalCostEth} ETH`,
  );

  // Check if balance is sufficient
  console.log("\n=== Sufficiency Check ===");
  if (balance > totalCost) {
    console.log("✅ Balance is sufficient for deployment");
  } else {
    const needed = totalCost - balance;
    const neededEth = formatEther(needed);
    console.log(`❌ Insufficient balance. Need ${neededEth} more ETH`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
