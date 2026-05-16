/**
 * Diagnose why createCollectionWithSeparateReceivers is reverting on
 * the live factory. Run with:
 *   npx tsx scripts/diagnose-factory.ts
 */
import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { baseSepolia, base } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config();

const FACTORY = process.env.FACTORY_CONTRACT_ADDRESS as `0x${string}`;
const BACKEND_WALLET = process.env.DEPLOYER_ADDRESS as
  | `0x${string}`
  | undefined;
const TREASURY = process.env.PLATFORM_TREASURY_ADDRESS as `0x${string}`;
const RPC =
  process.env.BASE_SEPOLIA_RPC_URL ||
  process.env.BASE_RPC_URL ||
  "https://sepolia.base.org";

const chain = process.env.EVM_NETWORK === "base-mainnet" ? base : baseSepolia;

const client = createPublicClient({ chain, transport: http(RPC) });

const ABI = parseAbi([
  "function owner() view returns (address)",
  "function createCollectionWithSeparateReceivers(string,string,uint96,address[],uint256[],address[],uint256[],string,uint256,uint256) returns (address)",
]);

async function main() {
  console.log("Factory:", FACTORY);
  console.log("Chain:  ", chain.name);

  // 1. Check factory owner
  const owner = (await client.readContract({
    address: FACTORY,
    abi: ABI,
    functionName: "owner",
  })) as string;
  console.log("Factory owner:", owner);
  console.log("Treasury:     ", TREASURY);
  if (BACKEND_WALLET) console.log("Backend wallet:", BACKEND_WALLET);

  if (BACKEND_WALLET && getAddress(owner) !== getAddress(BACKEND_WALLET)) {
    console.log(
      "⚠️  Factory owner does NOT match backend wallet — onlyOwner will revert",
    );
  } else {
    console.log("✓ Factory owner check OK (or DEPLOYER_ADDRESS not set)");
  }

  // 2. Simulate the failing call to get the real revert reason
  try {
    await client.simulateContract({
      address: FACTORY,
      abi: ABI,
      functionName: "createCollectionWithSeparateReceivers",
      args: [
        "Test Collection",
        "TEST",
        250n,
        [TREASURY],
        [250n],
        [TREASURY],
        [10000n],
        "ipfs://QmTestDiagnostic",
        2500n,
        250n,
      ],
      account: getAddress(owner) as `0x${string}`,
    });
    console.log("✓ Simulation succeeded — the call should not revert");
  } catch (err: any) {
    console.log("\n❌ Simulation reverted:");
    console.log("   shortMessage:", err.shortMessage);
    console.log("   details:     ", err.details);
    if (err.cause?.data) console.log("   data:        ", err.cause.data);
    if (err.metaMessages) {
      console.log("   meta:");
      err.metaMessages.forEach((m: string) => console.log("     " + m));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
