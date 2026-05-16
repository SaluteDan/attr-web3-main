import { ethers } from "hardhat";
import { NFTCollection, NFTCollection__factory } from "../../typechain-types";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying NFTCollection with account:", deployer.address);

  // Deploy NFTCollection directly (bypassing factory)
  const NFTCollection = await ethers.getContractFactory("NFTCollection");

  const collection = await NFTCollection.deploy(
    "Axis Collection", // name
    "AXIS", // symbol
    deployer.address, // initialOwner (backend wallet)
    deployer.address, // royaltyReceiver
    500, // royaltyFeeNumerator (5%)
    "https://lavender-perfect-rattlesnake-216.mypinata.cloud/ipfs/QmTest", // contractURI (collection metadata)
    1000, // maxSupply
    deployer.address, // paymentReceiver
    20, // maxMintPerWallet
  );

  await collection.waitForDeployment();
  const address = await collection.getAddress();

  console.log("NFTCollection deployed to:", address);
  console.log("Owner:", collection.owner());
  console.log("Contract", collection);
  console.log("\nUse this address to test the mint flow.");
  console.log(
    "Update your test collection's contractAddress in the database to:",
    address,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
