// Working deployment script for Hardhat 3 Beta
import fs from 'fs';

async function main() {
  console.log("Starting Bitcoin Yield Vault deployment...");
  
  // For Hardhat 3, we need to import ethers directly from the ethers package
  // and use hardhat's network provider
  const { ethers } = await import("ethers");
  const hre = await import("hardhat");
  
  // Create provider and signer using Hardhat's network configuration
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545"); // Hardhat local network
  
  // Use the private key from environment or hardhat's default
  const privateKey = process.env.PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const deployer = new ethers.Wallet(privateKey, provider);
  
  console.log("Deploying contracts with account:", deployer.address);
  
  try {
    const balance = await deployer.provider.getBalance(deployer.address);
    console.log("Account balance:", ethers.formatEther(balance), "ETH");
  } catch (error) {
    console.log("Could not get balance, but continuing with deployment...");
  }

  // Helper function to deploy contracts
  async function deployContract(name: string, ...args: any[]) {
    console.log(`\\nDeploying ${name}...`);
    
    const artifact = await hre.artifacts.readArtifact(name);
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    console.log(`${name} deployed to:`, address);
    
    return contract;
  }

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

  // Authorize BitcoinYieldVault in CrossChainYield
  console.log("\\nAuthorizing BitcoinYieldVault in CrossChainYield...");
  await crossChainYield.setAuthorizedVault(bitcoinYieldVaultAddress, true);

  // Deploy protocol adapters
  const deployedAdapters: { [key: string]: string } = {};

  // Deploy CompoundAdapter
  const compoundAdapter = await deployContract(
    "CompoundAdapter",
    "0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5", // cETH
    "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B"  // Comptroller
  );
  const compoundAdapterAddress = await compoundAdapter.getAddress();
  deployedAdapters["compound"] = compoundAdapterAddress;

  // Add Compound protocol to CrossChainYield
  await crossChainYield.addProtocol(
    compoundAdapterAddress,
    "0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5", // cETH
    1, // Ethereum
    500, // 5% APY
    "Compound Ethereum",
    ethers.parseEther("0.01"), // Min deposit: 0.01 BTC
    ethers.parseEther("100")   // Max deposit: 100 BTC
  );
  console.log("Added Compound protocol to CrossChainYield");

  // Deploy AaveAdapter
  const aaveAdapter = await deployContract(
    "AaveAdapter",
    "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9", // LendingPoolAddressesProvider
    "0x028171bCA77440897B824Ca71D1c56caC55b68A3", // aDAI
    "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5", // IncentivesController
    "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9"  // AAVE token
  );
  const aaveAdapterAddress = await aaveAdapter.getAddress();
  deployedAdapters["aave"] = aaveAdapterAddress;

  // Add Aave protocol to CrossChainYield
  await crossChainYield.addProtocol(
    aaveAdapterAddress,
    "0x028171bCA77440897B824Ca71D1c56caC55b68A3", // aDAI
    1, // Ethereum
    300, // 3% APY
    "Aave Ethereum",
    ethers.parseEther("0.01"), // Min deposit: 0.01 BTC
    ethers.parseEther("200")   // Max deposit: 200 BTC
  );
  console.log("Added Aave protocol to CrossChainYield");

  // Deploy PancakeSwapAdapter
  const pancakeSwapAdapter = await deployContract(
    "PancakeSwapAdapter",
    "0x10ED43C718714eb63d5aA57B78B54704E256024E", // Router
    "0xa5f8C5Dbd5F286960b9d90548680aE5ebFf07652", // MasterChef
    "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0", // LP Token
    "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", // CAKE token
    251 // Pool ID
  );
  const pancakeSwapAdapterAddress = await pancakeSwapAdapter.getAddress();
  deployedAdapters["pancakeswap"] = pancakeSwapAdapterAddress;

  // Add PancakeSwap protocol to CrossChainYield
  await crossChainYield.addProtocol(
    pancakeSwapAdapterAddress,
    "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0", // LP Token
    56, // BSC
    1500, // 15% APY
    "PancakeSwap BSC",
    ethers.parseEther("0.01"), // Min deposit: 0.01 BTC
    ethers.parseEther("50")    // Max deposit: 50 BTC
  );
  console.log("Added PancakeSwap protocol to CrossChainYield");

  // Deploy QuickSwapAdapter
  const quickSwapAdapter = await deployContract(
    "QuickSwapAdapter",
    "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // Router
    "0x8eC6C5C632e9aB8e7a7b1e6c2b5c5F5Dc5B5B5B5", // StakingRewards
    "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", // LP Token
    "0x831753DD7087CaC61aB5644b308642cc1c33Dc13", // QUICK token
    "0x958d208Cdf087843e9AD98d23823d32E17d723A1"  // dQUICK token
  );
  const quickSwapAdapterAddress = await quickSwapAdapter.getAddress();
  deployedAdapters["quickswap"] = quickSwapAdapterAddress;

  // Add QuickSwap protocol to CrossChainYield
  await crossChainYield.addProtocol(
    quickSwapAdapterAddress,
    "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", // LP Token
    137, // Polygon
    2000, // 20% APY
    "QuickSwap Polygon",
    ethers.parseEther("0.01"), // Min deposit: 0.01 BTC
    ethers.parseEther("75")    // Max deposit: 75 BTC
  );
  console.log("Added QuickSwap protocol to CrossChainYield");

  // Set system parameters
  console.log("\\nSetting system parameters...");
  await crossChainYield.setParameters(300, 3); // 3% slippage, 3 max retries

  console.log("\\n=== DEPLOYMENT COMPLETE ===");
  console.log("Contract Addresses:");
  console.log("- SystemContract:", systemContractAddress);
  console.log("- BitcoinYieldVault:", bitcoinYieldVaultAddress);
  console.log("- CrossChainYield:", crossChainYieldAddress);
  console.log("\\nProtocol Adapters:");
  for (const [key, address] of Object.entries(deployedAdapters)) {
    console.log(`- ${key}:`, address);
  }

  // Save deployment info
  const deploymentInfo = {
    timestamp: new Date().toISOString(),
    network: "hardhat",
    deployer: deployer.address,
    contracts: {
      SystemContract: systemContractAddress,
      BitcoinYieldVault: bitcoinYieldVaultAddress,
      CrossChainYield: crossChainYieldAddress,
      ...deployedAdapters
    }
  };

  fs.writeFileSync(
    `deployment-${Date.now()}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );

  // Test the deployment
  console.log("\\n=== TESTING DEPLOYMENT ===");
  const protocolCount = await crossChainYield.protocolCount();
  console.log("Protocol count:", protocolCount.toString());
  
  const isVaultAuthorized = await crossChainYield.authorizedVaults(bitcoinYieldVaultAddress);
  console.log("Vault authorized:", isVaultAuthorized);
  
  const stats = await crossChainYield.getVaultStats();
  console.log("Vault stats:");
  console.log("- Total TVL:", stats.totalTvl.toString());
  console.log("- Active Protocols:", stats.activeProtocols.toString());

  console.log("\\n🎉 Bitcoin Yield Vault deployment successful!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    console.error("Stack trace:", error.stack);
    process.exit(1);
  });