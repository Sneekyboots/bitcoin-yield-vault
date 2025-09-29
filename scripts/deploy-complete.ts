import fs from 'fs';
import { ethers } from "ethers";

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
  
const hre = require("hardhat");
const { ethers } = hre;

  
  const [deployer] = await ethers.getSigners();
  
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());
  console.log("Network:", hre.network.name);

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

  // Deploy AaveAdapter (generic example)
  console.log("\\nDeploying AaveAdapter...");
  const AaveAdapter = await ethers.getContractFactory("AaveAdapter");
  const aaveAdapter = await AaveAdapter.deploy(
    "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9", // Aave V2 LendingPoolAddressesProvider (mainnet)
    "0x028171bCA77440897B824Ca71D1c56caC55b68A3", // aDAI (example)
    "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5", // Aave IncentivesController
    "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9"  // AAVE token
  );
  await aaveAdapter.deployed();
  console.log("AaveAdapter deployed to:", aaveAdapter.address);
  deployedAdapters["aave_1"] = aaveAdapter.address;

  // Add Aave protocol to CrossChainYield
  await crossChainYield.addProtocol(
    aaveAdapter.address,
    "0x028171bCA77440897B824Ca71D1c56caC55b68A3", // aDAI
    1,
    300, // 3% APY
    "Aave Ethereum",
    ethers.utils.parseEther("0.01"), // Min deposit: 0.01 BTC
    ethers.utils.parseEther("200") // Max deposit: 200 BTC
  );
  console.log("Added Aave protocol to CrossChainYield");

  // Deploy QuickSwapAdapter
  console.log("\\nDeploying QuickSwapAdapter...");
  const QuickSwapAdapter = await ethers.getContractFactory("QuickSwapAdapter");
  const quickSwapAdapter = await QuickSwapAdapter.deploy(
    "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // QuickSwap router (Polygon)
    "0x8eC6C5C632e9aB8e7a7b1e6c2b5c5F5Dc5B5B5B5", // Staking rewards (example)
    "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", // LP token (example)
    "0x831753DD7087CaC61aB5644b308642cc1c33Dc13", // QUICK token
    "0x958d208Cdf087843e9AD98d23823d32E17d723A1"  // dQUICK token
  );
  await quickSwapAdapter.deployed();
  console.log("QuickSwapAdapter deployed to:", quickSwapAdapter.address);
  deployedAdapters["quickswap_137"] = quickSwapAdapter.address;

  // Add QuickSwap protocol to CrossChainYield
  await crossChainYield.addProtocol(
    quickSwapAdapter.address,
    "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", // LP token
    137, // Polygon
    2000, // 20% APY
    "QuickSwap Polygon",
    ethers.utils.parseEther("0.01"), // Min deposit: 0.01 BTC
    ethers.utils.parseEther("75") // Max deposit: 75 BTC
  );
  console.log("Added QuickSwap protocol to CrossChainYield");

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
    network: hre.network.name,
    deployer: deployer.address,
    contracts: {
      SystemContract: systemContract.address,
      BitcoinYieldVault: bitcoinYieldVault.address,
      CrossChainYield: crossChainYield.address,
      ...deployedAdapters
    },
    config
  };

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

  // Display protocol information
  console.log("\\n=== PROTOCOL INFORMATION ===");
  const protocolCount = await crossChainYield.protocolCount();
  for (let i = 0; i < protocolCount; i++) {
    const protocol = await crossChainYield.protocols(i);
    console.log(`Protocol ${i}:`);
    console.log(`  - Adapter: ${protocol.adapter}`);
    console.log(`  - Asset: ${protocol.asset}`);
    console.log(`  - Chain ID: ${protocol.chainId}`);
    console.log(`  - APY: ${protocol.apy / 100}%`);
    console.log(`  - Name: ${protocol.name}`);
    console.log(`  - Min Deposit: ${ethers.utils.formatEther(protocol.minDeposit)} BTC`);
    console.log(`  - Max Deposit: ${ethers.utils.formatEther(protocol.maxDeposit)} BTC`);
    console.log(`  - Active: ${protocol.active}`);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });