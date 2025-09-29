// Simple deployment script that works with Hardhat 3 Beta
import fs from 'fs';

async function main() {
  console.log("Starting Bitcoin Yield Vault deployment...");
  
  // Import ethers and hardhat
  const { ethers } = await import("ethers");
  const hre = await import("hardhat");
  
  console.log("Using Hardhat's built-in network for deployment");
  
  // Use hardhat's default provider and accounts
  const accounts = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // Account #0
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"  // Account #1
  ];
  
  // Create a simple provider for the in-memory hardhat network
  const provider = new ethers.JsonRpcProvider();
  const deployer = new ethers.Wallet(accounts[0], provider);
  
  console.log("Deploying contracts with account:", deployer.address);

  // Helper function to deploy contracts using artifacts
  async function deployContract(name: string, ...args: any[]) {
    console.log(`\\nDeploying ${name}...`);
    
    try {
      // Read contract artifact
      const artifact = await hre.artifacts.readArtifact(name);
      
      // Create contract factory
      const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
      
      // Deploy contract
      const contract = await factory.deploy(...args);
      const address = await contract.getAddress();
      
      console.log(`${name} deployed to:`, address);
      return contract;
      
    } catch (error) {
      console.error(`Failed to deploy ${name}:`, error);
      throw error;
    }
  }

  try {
    // Deploy SystemContract mock for testing
    const systemContract = await deployContract("SystemContract");
    const systemContractAddress = await systemContract.getAddress();

    // Deploy CrossChainYield
    const crossChainYield = await deployContract(
      "CrossChainYield",
      systemContractAddress,
      deployer.address // emergency admin
    );
    const crossChainYieldAddress = await crossChainYield.getAddress();

    // Deploy BitcoinYieldVault
    const bitcoinYieldVault = await deployContract(
      "BitcoinYieldVault",
      systemContractAddress,
      crossChainYieldAddress,
      deployer.address // treasury
    );
    const bitcoinYieldVaultAddress = await bitcoinYieldVault.getAddress();

    console.log("\\n=== BASIC DEPLOYMENT COMPLETE ===");
    console.log("Core Contract Addresses:");
    console.log("- SystemContract:", systemContractAddress);
    console.log("- CrossChainYield:", crossChainYieldAddress);
    console.log("- BitcoinYieldVault:", bitcoinYieldVaultAddress);

    // Save basic deployment info
    const deploymentInfo = {
      timestamp: new Date().toISOString(),
      network: "hardhat-memory",
      deployer: deployer.address,
      contracts: {
        SystemContract: systemContractAddress,
        CrossChainYield: crossChainYieldAddress,
        BitcoinYieldVault: bitcoinYieldVaultAddress
      }
    };

    fs.writeFileSync(
      `deployment-basic-${Date.now()}.json`,
      JSON.stringify(deploymentInfo, null, 2)
    );

    console.log("\\n🎉 Basic Bitcoin Yield Vault deployment successful!");
    console.log("\\nNext steps:");
    console.log("1. Run adapter deployment script");
    console.log("2. Configure protocols");
    console.log("3. Test functionality");

  } catch (error) {
    console.error("Deployment error:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });