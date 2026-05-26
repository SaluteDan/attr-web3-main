import { HardhatUserConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import * as dotenv from "dotenv";

dotenv.config();

// Load solidity-coverage plugin if available
let hardhatCoverage: unknown;
try {
  const coverageModule = await import("solidity-coverage");
  hardhatCoverage =
    (coverageModule as { default?: unknown }).default ?? coverageModule;
} catch {
  hardhatCoverage = null;
}

const config: HardhatUserConfig = {
  plugins: [
    hardhatViem,
    hardhatVerify,
    hardhatNodeTestRunner,
    hardhatNetworkHelpers,
    hardhatViemAssertions,
    ...(hardhatCoverage ? [hardhatCoverage] : []),
  ],
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    baseSepolia: {
      type: "http",
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 84532,
    },
    baseMainnet: {
      type: "http",
      url: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 8453,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test/contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  verify: {
    etherscan: {
      apiKey: process.env.BASESCAN_API_KEY || "",
    },
  },
};

export default config;
