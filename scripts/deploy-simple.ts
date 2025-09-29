import hre from "hardhat";
import { ethers } from "hardhat";

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
  
  // Import hardhat runtime environment dynamically to work with Hardhat 3
  const hre = await import("hardhat");
  const ethers = hre.ethers;
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());
  // Update config with deployer address if needed
  const config = { ...defaultConfig };
  if (config.treasury === "0x0000000000000000000000000000000000000000") {
    config.treasury = deployer.address;
  }
  if (config.emergencyAdmin === "0x0000000000000000000000000000000000000000") {
    config.emergencyAdmin = deployer.address;
  }

  // Deploy SystemContract mock for testing
  console.log("\\nDeploying SystemContract...");
  const SystemContract = await ethers.getContractFactory("SystemContract");
  const systemContract = await SystemContract.deploy();
  await systemContract.deployed();
  console.log("SystemContract deployed to:", systemContract.address);
  
  config.systemContract = systemContract.address;

  // Deploy CrossChainYield
  console.log("\\nDeploying CrossChainYield...");
  const CrossChainYield = await ethers.getContractFactory("CrossChainYield");
  const crossChainYield = await CrossChainYield.deploy(
    config.systemContract,
    config.emergencyAdmin
  );
  await crossChainYield.deployed();
  console.log("CrossChainYield deployed to:", crossChainYield.address);

  // Deploy BitcoinYieldVault
  console.log("\\nDeploying BitcoinYieldVault...");
  const BitcoinYieldVault = await ethers.getContractFactory("BitcoinYieldVault");
  const bitcoinYieldVault = await BitcoinYieldVault.deploy(
    config.systemContract,
    crossChainYield.address,
    config.treasury
  );
  await bitcoinYieldVault.deployed();
  console.log("BitcoinYieldVault deployed to:", bitcoinYieldVault.address);

  // Authorize BitcoinYieldVault in CrossChainYield
  console.log("\\nAuthorizing BitcoinYieldVault in CrossChainYield...");
  await crossChainYield.setAuthorizedVault(bitcoinYieldVault.address, true);

  // Deploy protocol adapters
  const deployedAdapters: { [key: string]: string } = {};

  // Deploy CompoundAdapter for Ethereum
  if (config.chainConfigs[1].protocols.compound) {
    console.log("\\nDeploying CompoundAdapter...");
    const CompoundAdapter = await ethers.getContractFactory("CompoundAdapter");
    const compoundAdapter = await CompoundAdapter.deploy(
      config.chainConfigs[1].protocols.compound.cToken,
      config.chainConfigs[1].protocols.compound.comptroller
    );
    await compoundAdapter.deployed();
    console.log("CompoundAdapter deployed to:", compoundAdapter.address);
    deployedAdapters["compound_1"] = compoundAdapter.address;

    // Add protocol to CrossChainYield
    await crossChainYield.addProtocol(
      compoundAdapter.address,
      config.chainConfigs[1].protocols.compound.cToken,
      1,
      500, // 5% APY
      "Compound Ethereum",
      ethers.utils.parseEther("0.01"), // Min deposit: 0.01 BTC
      ethers.utils.parseEther("100") // Max deposit: 100 BTC
    );
    console.log("Added Compound protocol to CrossChainYield");
  }

  // Deploy PancakeSwapAdapter for BSC
  if (config.chainConfigs[56].protocols.pancakeswap) {
    console.log("\\nDeploying PancakeSwapAdapter...");
    const PancakeSwapAdapter = await ethers.getContractFactory("PancakeSwapAdapter");
    const pancakeSwapAdapter = await PancakeSwapAdapter.deploy(
      config.chainConfigs[56].protocols.pancakeswap.router,
      config.chainConfigs[56].protocols.pancakeswap.masterChef,
      config.chainConfigs[56].protocols.pancakeswap.lpToken,
      config.chainConfigs[56].protocols.pancakeswap.cakeToken,
      config.chainConfigs[56].protocols.pancakeswap.poolId
    );
    await pancakeSwapAdapter.deployed();
    console.log("PancakeSwapAdapter deployed to:", pancakeSwapAdapter.address);
    deployedAdapters["pancakeswap_56"] = pancakeSwapAdapter.address;

    // Add protocol to CrossChainYield
    await crossChainYield.addProtocol(
      pancakeSwapAdapter.address,
      config.chainConfigs[56].protocols.pancakeswap.lpToken,
      56,
      1500, // 15% APY
      "PancakeSwap BSC",
      ethers.utils.parseEther("0.01"), // Min deposit: 0.01 BTC
      ethers.utils.parseEther("50") // Max deposit: 50 BTC
    );
    console.log("Added PancakeSwap protocol to CrossChainYield");
  }

  // Final configuration
  console.log("\\nFinalizing deployment configuration...");
  
  // Set default parameters for CrossChainYield
  await crossChainYield.setParameters(300, 3); // 3% slippage, 3 max retries

  console.log("\\n=== DEPLOYMENT COMPLETE ===");
  console.log("Contract Addresses:");
  console.log("- SystemContract:", systemContract.address);
  console.log("- BitcoinYieldVault:", bitcoinYieldVault.address);
  console.log("- CrossChainYield:", crossChainYield.address);
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
    network: await ethers.provider.getNetwork(),
    deployer: deployer.address,
    contracts: {
      SystemContract: systemContract.address,
      BitcoinYieldVault: bitcoinYieldVault.address,
      CrossChainYield: crossChainYield.address,
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
  console.log("Vault authorized:", await crossChainYield.authorizedVaults(bitcoinYieldVault.address));
  
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