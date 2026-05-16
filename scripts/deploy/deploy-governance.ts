import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying GovernanceNFT with account:", deployer.address);

  // Configuration - Update these values or use Environment Variables
  const NAME = process.env.GOV_NAME || "Platform Membership";
  const SYMBOL = process.env.GOV_SYMBOL || "MBR";
  const MAX_SUPPLY = process.env.GOV_MAX_SUPPLY || "1000";
  const CONTRACT_URI =
    process.env.GOV_CONTRACT_URI || "ipfs://QmYourMetadataHash";
  const ROYALTY_BPS = process.env.GOV_ROYALTY_BPS || "500"; // 5%
  const MAX_MINT_PER_WALLET = process.env.GOV_MAX_MINT || "1";

  const ROYALTY_RECEIVER = process.env.GOV_ROYALTY_RECEIVER || deployer.address;
  const PAYMENT_RECEIVER = process.env.GOV_PAYMENT_RECEIVER || deployer.address;

  console.log("Configuration:");
  console.log("- Name:", NAME);
  console.log("- Symbol:", SYMBOL);
  console.log("- Max Supply:", MAX_SUPPLY);
  console.log("- Royalty Receiver:", ROYALTY_RECEIVER);

  const GovernanceNFT = await ethers.getContractFactory("GovernanceNFT");

  const governanceNFT = await GovernanceNFT.deploy(
    NAME,
    SYMBOL,
    deployer.address, // Initial Owner
    ROYALTY_RECEIVER,
    BigInt(ROYALTY_BPS),
    CONTRACT_URI,
    BigInt(MAX_SUPPLY),
    PAYMENT_RECEIVER,
    BigInt(MAX_MINT_PER_WALLET)
  );

  await governanceNFT.waitForDeployment();
  const address = await governanceNFT.getAddress();

  console.log(`GovernanceNFT deployed to: ${address}`);
  console.log(
    `\nVerify with:\nnpx hardhat verify --network baseSepolia ${address} "${NAME}" "${SYMBOL}" "${deployer.address}" "${ROYALTY_RECEIVER}" ${ROYALTY_BPS} "${CONTRACT_URI}" ${MAX_SUPPLY} "${PAYMENT_RECEIVER}" ${MAX_MINT_PER_WALLET}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
