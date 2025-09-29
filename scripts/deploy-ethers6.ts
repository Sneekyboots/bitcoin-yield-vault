// Import ethers directly since Hardhat 3 doesn't expose it on hre
import { ethers } from "ethers";
import hre from "hardhat";

interface DeploymentConfig {
  systemContract: string;
  treasury: string;
  emergencyAdmin: string;
  chainConfigs: {
    [chainId: number]: {
      name: string;
      zrc20: string;
      protocols: {
        compound?: {
          cToken: string;
          comptroller: string;
        };
        aave?: {
          lendingPoolProvider: string;
          aToken: string;
          rewardsController: string;
          rewardToken: string;
        };
        pancakeswap?: {
          router: string;
          masterChef: string;
          lpToken: string;
          cakeToken: string;
          poolId: number;
        };
        quickswap?: {
          router: string;
          stakingRewards: string;
          lpToken: string;
          quickToken: string;
          dQuickToken?: string;
        };
      };
    };
  };
}

// Default configuration for testing/development
const defaultConfig: DeploymentConfig = {
  systemContract: "0x0000000000000000000000000000000000000000", // Will be set during deployment
  treasury: "0x0000000000000000000000000000000000000000", // Will be set during deployment
  emergencyAdmin: "0x0000000000000000000000000000000000000000", // Will be set during deployment
  chainConfigs: {
    1: { // Ethereum
      name: "Ethereum",
      zrc20: "0x0000000000000000000000000000000000000000",
      protocols: {
        compound: {
          cToken: "0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5", // cETH
          comptroller: "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B"
        }
      }
    },
    56: { // BSC
      name: "BSC",
      zrc20: "0x0000000000000000000000000000000000000000",
      protocols: {
        pancakeswap: {
          router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
          masterChef: "0xa5f8C5Dbd5F286960b9d90548680aE5ebFf07652",
          lpToken: "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0", // WBNB-CAKE LP
          cakeToken: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
          poolId: 251
        }
      }
    }
  }
};

async function main() {
  console.log("Starting Bitcoin Yield Vault deployment...");
  
  // Get ethers and provider through Hardhat's network
  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY || "0x" + "0".repeat(64), provider);
  
  console.log("Deploying contracts with account:", signer.address);
  console.log("Network:", hre.network.name);

  // Update config with signer address if needed
  const config = { ...defaultConfig };
  if (config.treasury === "0x0000000000000000000000000000000000000000") {
    config.treasury = signer.address;
  }
  if (config.emergencyAdmin === "0x0000000000000000000000000000000000000000") {
    config.emergencyAdmin = signer.address;
  }

  // Get contract factories from artifacts
  const SystemContractArtifact = await hre.artifacts.readArtifact("SystemContract");
  const SystemContractFactory = new ethers.ContractFactory(
    SystemContractArtifact.abi,
    SystemContractArtifact.bytecode,
    signer
  );

  // Deploy SystemContract mock for testing
  console.log("\\nDeploying SystemContract...");
  const systemContract = await SystemContractFactory.deploy();
  await systemContract.waitForDeployment();
  const systemContractAddress = await systemContract.getAddress();
  console.log("SystemContract deployed to:", systemContractAddress);
  
  config.systemContract = systemContractAddress;

  // Deploy CrossChainYield
  console.log("\\nDeploying CrossChainYield...");
  const CrossChainYieldArtifact = await hre.artifacts.readArtifact("CrossChainYield");
  const CrossChainYieldFactory = new ethers.ContractFactory(
    CrossChainYieldArtifact.abi,
    CrossChainYieldArtifact.bytecode,
    signer
  );
  
  const crossChainYield = await CrossChainYieldFactory.deploy(
    config.systemContract,
    config.emergencyAdmin
  );
  await crossChainYield.waitForDeployment();
  const crossChainYieldAddress = await crossChainYield.getAddress();
  console.log("CrossChainYield deployed to:", crossChainYieldAddress);

  // Deploy BitcoinYieldVault
  console.log("\\nDeploying BitcoinYieldVault...");
  const BitcoinYieldVaultArtifact = await hre.artifacts.readArtifact("BitcoinYieldVault");
  const BitcoinYieldVaultFactory = new ethers.ContractFactory(
    BitcoinYieldVaultArtifact.abi,
    BitcoinYieldVaultArtifact.bytecode,
    signer
  );
  
  const bitcoinYieldVault = await BitcoinYieldVaultFactory.deploy(
    config.systemContract,
    crossChainYieldAddress,
    config.treasury
  );
  await bitcoinYieldVault.waitForDeployment();
  const bitcoinYieldVaultAddress = await bitcoinYieldVault.getAddress();
  console.log("BitcoinYieldVault deployed to:", bitcoinYieldVaultAddress);

  // Authorize BitcoinYieldVault in CrossChainYield
  console.log("\\nAuthorizing BitcoinYieldVault in CrossChainYield...");
  await crossChainYield.setAuthorizedVault(bitcoinYieldVaultAddress, true);

  // Deploy protocol adapters
  const deployedAdapters: { [key: string]: string } = {};

  // Deploy CompoundAdapter for Ethereum
  if (config.chainConfigs[1].protocols.compound) {
    console.log("\\nDeploying CompoundAdapter...");
    const CompoundAdapterArtifact = await hre.artifacts.readArtifact("CompoundAdapter");
    const CompoundAdapterFactory = new ethers.ContractFactory(
      CompoundAdapterArtifact.abi,
      CompoundAdapterArtifact.bytecode,
      signer
    );
    
    const compoundAdapter = await CompoundAdapterFactory.deploy(
      config.chainConfigs[1].protocols.compound.cToken,
      config.chainConfigs[1].protocols.compound.comptroller
    );
    await compoundAdapter.waitForDeployment();
    const compoundAdapterAddress = await compoundAdapter.getAddress();
    console.log("CompoundAdapter deployed to:", compoundAdapterAddress);
    deployedAdapters["compound_1"] = compoundAdapterAddress;

    // Add protocol to CrossChainYield
    await crossChainYield.addProtocol(
      compoundAdapterAddress,
      config.chainConfigs[1].protocols.compound.cToken,
      1,
      500, // 5% APY
      "Compound Ethereum",
      ethers.parseEther("0.01"), // Min deposit: 0.01 BTC
      ethers.parseEther("100") // Max deposit: 100 BTC
    );
    console.log("Added Compound protocol to CrossChainYield");
  }

  // Deploy PancakeSwapAdapter for BSC
  if (config.chainConfigs[56].protocols.pancakeswap) {
    console.log("\\nDeploying PancakeSwapAdapter...");
    const PancakeSwapAdapterArtifact = await hre.artifacts.readArtifact("PancakeSwapAdapter");
    const PancakeSwapAdapterFactory = new ethers.ContractFactory(
      PancakeSwapAdapterArtifact.abi,
      PancakeSwapAdapterArtifact.bytecode,
      signer
    );
    
    const pancakeSwapAdapter = await PancakeSwapAdapterFactory.deploy(
      config.chainConfigs[56].protocols.pancakeswap.router,
      config.chainConfigs[56].protocols.pancakeswap.masterChef,
      config.chainConfigs[56].protocols.pancakeswap.lpToken,
      config.chainConfigs[56].protocols.pancakeswap.cakeToken,
      config.chainConfigs[56].protocols.pancakeswap.poolId
    );
    await pancakeSwapAdapter.waitForDeployment();
    const pancakeSwapAdapterAddress = await pancakeSwapAdapter.getAddress();
    console.log("PancakeSwapAdapter deployed to:", pancakeSwapAdapterAddress);
    deployedAdapters["pancakeswap_56"] = pancakeSwapAdapterAddress;

    // Add protocol to CrossChainYield
    await crossChainYield.addProtocol(
      pancakeSwapAdapterAddress,
      config.chainConfigs[56].protocols.pancakeswap.lpToken,
      56,
      1500, // 15% APY
      "PancakeSwap BSC",
      ethers.parseEther("0.01"), // Min deposit: 0.01 BTC
      ethers.parseEther("50") // Max deposit: 50 BTC
    );
    console.log("Added PancakeSwap protocol to CrossChainYield");
  }

  // Final configuration
  console.log("\\nFinalizing deployment configuration...");
  
  // Set default parameters for CrossChainYield
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

  console.log("\\nConfiguration:");
  console.log("- Treasury:", config.treasury);
  console.log("- Emergency Admin:", config.emergencyAdmin);
  console.log("- Default Slippage: 3%");
  console.log("- Max Retries: 3");

  // Save deployment info to file
  const deploymentInfo = {
    timestamp: new Date().toISOString(),
    network: hre.network.name,
    deployer: signer.address,
    contracts: {
      SystemContract: systemContractAddress,
      BitcoinYieldVault: bitcoinYieldVaultAddress,
      CrossChainYield: crossChainYieldAddress,
      ...deployedAdapters
    },
    config
  };

  const fs = require('fs');
  fs.writeFileSync(
    `deployment-${Date.now()}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\\nDeployment info saved to deployment-{timestamp}.json");
  console.log("\\n🎉 Bitcoin Yield Vault deployment successful!");

  // Test the deployment
  console.log("\\n=== TESTING DEPLOYMENT ===");
  console.log("Protocol count:", (await crossChainYield.protocolCount()).toString());
  console.log("Vault authorized:", await crossChainYield.authorizedVaults(bitcoinYieldVaultAddress));
  
  const stats = await crossChainYield.getVaultStats();
  console.log("Vault stats:");
  console.log("- Total TVL:", stats.totalTvl.toString());
  console.log("- Active Protocols:", stats.activeProtocols.toString());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });