import { ethers } from "ethers";
import { promises as fs } from "fs";
import path from "path";

async function main() {
  console.log("Starting Bitcoin Yield Vault deployment with nonce management...");

  // Connect to the network
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const [deployer] = await provider.listAccounts();
  
  if (!deployer) {
    throw new Error("No accounts found");
  }

  // Get the signer with explicit nonce management
  const deployerSigner = await provider.getSigner(deployer.address);
  console.log("Deploying contracts with account:", deployer.address);

  // Get current nonce to ensure proper sequencing
  const nonce = await provider.getTransactionCount(deployer.address);
  console.log("Current nonce:", nonce);

  try {
    // Load contract artifacts
    const bitcoinYieldVaultPath = path.join(process.cwd(), "artifacts/contracts/BitcoinYieldVault.sol/BitcoinYieldVault.json");
    const crossChainYieldPath = path.join(process.cwd(), "artifacts/contracts/CrossChainYield.sol/CrossChainYield.json");

    const bitcoinYieldVaultArtifact = JSON.parse(await fs.readFile(bitcoinYieldVaultPath, "utf8"));
    const crossChainYieldArtifact = JSON.parse(await fs.readFile(crossChainYieldPath, "utf8"));

    // Deploy BitcoinYieldVault with specific nonce
    console.log("\nDeploying BitcoinYieldVault...");
    const BitcoinYieldVaultFactory = new ethers.ContractFactory(
      bitcoinYieldVaultArtifact.abi,
      bitcoinYieldVaultArtifact.bytecode,
      deployerSigner
    );

    const bitcoinYieldVault = await BitcoinYieldVaultFactory.deploy({
      nonce: nonce
    });
    await bitcoinYieldVault.waitForDeployment();
    const bitcoinYieldVaultAddress = await bitcoinYieldVault.getAddress();
    console.log("BitcoinYieldVault deployed to:", bitcoinYieldVaultAddress);

    // Deploy CrossChainYield with next nonce
    console.log("\nDeploying CrossChainYield...");
    const CrossChainYieldFactory = new ethers.ContractFactory(
      crossChainYieldArtifact.abi,
      crossChainYieldArtifact.bytecode,
      deployerSigner
    );

    const crossChainYield = await CrossChainYieldFactory.deploy(
      bitcoinYieldVaultAddress,  // bitcoinYieldVault address
      deployer.address,          // admin address
      {
        nonce: nonce + 1
      }
    );
    await crossChainYield.waitForDeployment();
    const crossChainYieldAddress = await crossChainYield.getAddress();
    console.log("CrossChainYield deployed to:", crossChainYieldAddress);

    // Deployment successful
    console.log("\n🎉 Deployment completed successfully!");
    console.log("=====================================");
    console.log("BitcoinYieldVault:", bitcoinYieldVaultAddress);
    console.log("CrossChainYield:", crossChainYieldAddress);
    console.log("Deployer:", deployer.address);
    console.log("=====================================");

    // Basic contract verification
    console.log("\n🔍 Verifying deployments...");
    const bitcoinYieldVaultBalance = await provider.getCode(bitcoinYieldVaultAddress);
    const crossChainBalance = await provider.getCode(crossChainYieldAddress);
    
    if (bitcoinYieldVaultBalance !== "0x") {
      console.log("✅ BitcoinYieldVault verified - contract code exists");
    } else {
      console.log("❌ BitcoinYieldVault verification failed");
    }

    if (crossChainBalance !== "0x") {
      console.log("✅ CrossChainYield verified - contract code exists");
    } else {
      console.log("❌ CrossChainYield verification failed");
    }

  } catch (error: any) {
    console.error("\n❌ Deployment failed:");
    console.error(error.message);
    
    if (error.code === 'NONCE_EXPIRED') {
      console.log("\n💡 Tip: The nonce was already used. Try restarting the Hardhat node or wait a moment.");
    } else if (error.code === 'INSUFFICIENT_FUNDS') {
      console.log("\n💡 Tip: Make sure the account has enough ETH for deployment.");
    } else if (error.message.includes('revert')) {
      console.log("\n💡 Tip: The contract deployment was reverted. Check constructor parameters.");
    }
    
    process.exit(1);
  }
}

// Handle errors gracefully
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Unexpected error:", error);
    process.exit(1);
  });