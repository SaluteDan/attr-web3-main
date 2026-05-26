import hre from "hardhat";

async function main() {
  const connection = await hre.network.create();
  const [deployer] = await connection.viem.getWalletClients();

  console.log(
    "Deploying NFTCollection with account:",
    deployer.account.address,
  );

  // Deploy NFTCollection directly (bypassing factory)
  const collection = await connection.viem.deployContract("NFTCollection", [
    "Axis Collection", // name
    "AXIS", // symbol
    deployer.account.address, // initialOwner (backend wallet)
    deployer.account.address, // royaltyReceiver
    500n, // royaltyFeeNumerator (5%)
    "https://lavender-perfect-rattlesnake-216.mypinata.cloud/ipfs/QmTest", // contractURI
    1000n, // maxSupply
    deployer.account.address, // paymentReceiver
    20n, // maxMintPerWallet
    deployer.account.address, // tipReceiver
    "0x0000000000000000000000000000000000000000" as `0x${string}`, // attrSpender
  ]);

  const address = collection.address;
  console.log("NFTCollection deployed to:", address);
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
