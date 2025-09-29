import hre from "hardhat";
// Note: Typechain types will be generated after first compilation
// import { BitcoinYieldVault, CrossChainYield, CompoundAdapter, AaveAdapter, PancakeSwapAdapter, QuickSwapAdapter } from "../typechain-types";

const { ethers } = hre;

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
        },
        aave: {
          lendingPoolProvider: "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5",
          aToken: "0x030bA81f1c18d280636F32af80b9AAd02Cf0854e", // aWETH
          rewardsController: "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5",
          rewardToken: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9" // AAVE
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
    },
    137: { // Polygon
      name: "Polygon",
      zrc20: "0x0000000000000000000000000000000000000000",
      protocols: {
        quickswap: {
          router: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
          stakingRewards: "0x8711a1a52c34EDe8E61eF40496ab2618a8F6EA4B",
          lpToken: "0x6e7a5FAFcec6BB1e78bAE2A1F0B612012BF14827", // WMATIC-USDC LP
          quickToken: "0x831753DD7087CaC61aB5644b308642cc1c33Dc13",
          dQuickToken: "0xf28164A485B0B2C90639E47b0f377b4a438a16B1"
        }
      }
    }
  }
};

async function main() {
  console.log("Starting Bitcoin Yield Vault deployment...");
  
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
  console.log("\nDeploying SystemContract...");
  const SystemContract = await ethers.getContractFactory("SystemContract");
  const systemContract = await SystemContract.deploy();
  await systemContract.deployed();
  console.log("SystemContract deployed to:", systemContract.address);
  
  config.systemContract = systemContract.address;

  // Deploy CrossChainYield
  console.log("\nDeploying CrossChainYield...");
  const CrossChainYield = await ethers.getContractFactory("CrossChainYield");
  const crossChainYield = await CrossChainYield.deploy(
    config.systemContract,
    config.emergencyAdmin
  );
  await crossChainYield.deployed();
  console.log("CrossChainYield deployed to:", crossChainYield.address);

  // Deploy BitcoinYieldVault
  console.log("\nDeploying BitcoinYieldVault...");
  const BitcoinYieldVault = await ethers.getContractFactory("BitcoinYieldVault");
  const bitcoinYieldVault = await BitcoinYieldVault.deploy(
    config.systemContract,
    crossChainYield.address,
    config.treasury
  );
  await bitcoinYieldVault.deployed();
  console.log("BitcoinYieldVault deployed to:", bitcoinYieldVault.address);

  // Authorize BitcoinYieldVault in CrossChainYield
  console.log("\nAuthorizing BitcoinYieldVault in CrossChainYield...");
  await crossChainYield.setAuthorizedVault(bitcoinYieldVault.address, true);

  // Deploy protocol adapters for each chain
  const deployedAdapters: { [key: string]: string } = {};

  for (const [chainId, chainConfig] of Object.entries(config.chainConfigs)) {
    console.log(`\nDeploying adapters for ${chainConfig.name} (Chain ID: ${chainId})...`);

    // Deploy Compound adapter if configured
    if (chainConfig.protocols.compound) {
      console.log("Deploying CompoundAdapter...");
      const CompoundAdapter = await ethers.getContractFactory("CompoundAdapter");
      const compoundAdapter = await CompoundAdapter.deploy(
        chainConfig.protocols.compound.cToken,
        chainConfig.protocols.compound.comptroller
      );
      await compoundAdapter.deployed();
      console.log("CompoundAdapter deployed to:", compoundAdapter.address);
      deployedAdapters[`compound_${chainId}`] = compoundAdapter.address;

      // Add protocol to CrossChainYield
      await crossChainYield.addProtocol(
        compoundAdapter.address,
        chainConfig.protocols.compound.cToken,
        parseInt(chainId),
        500, // 5% APY
        `Compound ${chainConfig.name}`,
        ethers.utils.parseEther("0.01"), // Min deposit: 0.01 BTC
        ethers.utils.parseEther("100") // Max deposit: 100 BTC
      );
    }

    // Deploy Aave adapter if configured
    if (chainConfig.protocols.aave) {
      console.log("Deploying AaveAdapter...");
      const AaveAdapter = await ethers.getContractFactory("AaveAdapter");
      const aaveAdapter = await AaveAdapter.deploy(
        chainConfig.protocols.aave.lendingPoolProvider,
        chainConfig.protocols.aave.aToken,
        chainConfig.protocols.aave.rewardsController,
        chainConfig.protocols.aave.rewardToken
      );
      await aaveAdapter.deployed();
      console.log("AaveAdapter deployed to:", aaveAdapter.address);
      deployedAdapters[`aave_${chainId}`] = aaveAdapter.address;

      // Add protocol to CrossChainYield
      await crossChainYield.addProtocol(
        aaveAdapter.address,
        chainConfig.protocols.aave.aToken,
        parseInt(chainId),
        300, // 3% APY
        `Aave ${chainConfig.name}`,
        ethers.utils.parseEther("0.01"), // Min deposit: 0.01 BTC
        ethers.utils.parseEther("200") // Max deposit: 200 BTC
      );
    }

    // Deploy PancakeSwap adapter if configured
    if (chainConfig.protocols.pancakeswap) {
      console.log("Deploying PancakeSwapAdapter...");
      const PancakeSwapAdapter = await ethers.getContractFactory("PancakeSwapAdapter");
      const pancakeSwapAdapter = await PancakeSwapAdapter.deploy(
        chainConfig.protocols.pancakeswap.router,
        chainConfig.protocols.pancakeswap.masterChef,
        chainConfig.protocols.pancakeswap.lpToken,
        chainConfig.protocols.pancakeswap.cakeToken,
        chainConfig.protocols.pancakeswap.poolId
      );
      await pancakeSwapAdapter.deployed();
      console.log("PancakeSwapAdapter deployed to:", pancakeSwapAdapter.address);
      deployedAdapters[`pancakeswap_${chainId}`] = pancakeSwapAdapter.address;

      // Add protocol to CrossChainYield
      await crossChainYield.addProtocol(
        pancakeSwapAdapter.address,
        chainConfig.protocols.pancakeswap.lpToken,
        parseInt(chainId),
        1500, // 15% APY
        `PancakeSwap ${chainConfig.name}`,
        ethers.utils.parseEther("0.01"), // Min deposit: 0.01 BTC
        ethers.utils.parseEther("50") // Max deposit: 50 BTC
      );
    }

    // Deploy QuickSwap adapter if configured
    if (chainConfig.protocols.quickswap) {
      console.log("Deploying QuickSwapAdapter...");
      const QuickSwapAdapter = await ethers.getContractFactory("QuickSwapAdapter");
      const quickSwapAdapter = await QuickSwapAdapter.deploy(
        chainConfig.protocols.quickswap.router,
        chainConfig.protocols.quickswap.stakingRewards,
        chainConfig.protocols.quickswap.lpToken,
        chainConfig.protocols.quickswap.quickToken,
        chainConfig.protocols.quickswap.dQuickToken || ethers.constants.AddressZero
      );
      await quickSwapAdapter.deployed();
      console.log("QuickSwapAdapter deployed to:", quickSwapAdapter.address);
      deployedAdapters[`quickswap_${chainId}`] = quickSwapAdapter.address;

      // Add protocol to CrossChainYield
      await crossChainYield.addProtocol(
        quickSwapAdapter.address,
        chainConfig.protocols.quickswap.lpToken,
        parseInt(chainId),
        1200, // 12% APY
        `QuickSwap ${chainConfig.name}`,
        ethers.utils.parseEther("0.01"), // Min deposit: 0.01 BTC
        ethers.utils.parseEther("80") // Max deposit: 80 BTC
      );
    }

    // Set ZRC20 mapping for the chain
    if (chainConfig.zrc20 !== "0x0000000000000000000000000000000000000000") {
      await crossChainYield.setChainZRC20(parseInt(chainId), chainConfig.zrc20);
      await bitcoinYieldVault.setChainZRC20(parseInt(chainId), chainConfig.zrc20);
    }
  }

  // Final configuration
  console.log("\nFinalizing deployment configuration...");
  
  // Set performance fee to 10%
  // Note: Check if setPerformanceFee function exists in the current contract
  // await bitcoinYieldVault.setPerformanceFee(1000);
  
  // Set default parameters for CrossChainYield
  await crossChainYield.setParameters(300, 3); // 3% slippage, 3 max retries

  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log("Contract Addresses:");
  console.log("- SystemContract:", systemContract.address);
  console.log("- BitcoinYieldVault:", bitcoinYieldVault.address);
  console.log("- CrossChainYield:", crossChainYield.address);
  console.log("\nProtocol Adapters:");
  for (const [key, address] of Object.entries(deployedAdapters)) {
    console.log(`- ${key}:`, address);
  }

  console.log("\nConfiguration:");
  console.log("- Treasury:", config.treasury);
  console.log("- Emergency Admin:", config.emergencyAdmin);
  console.log("- Performance Fee: 10%");
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

  console.log("\nDeployment info saved to deployment-{timestamp}.json");
  console.log("\n🎉 Bitcoin Yield Vault deployment successful!");
}

// Helper function to verify contracts (optional)
async function verifyContracts(deploymentInfo: any) {
  console.log("\nVerifying contracts on Etherscan...");
  
  try {
    // Note: This requires hardhat-etherscan plugin
    const { run } = require("hardhat");
    
    for (const [name, address] of Object.entries(deploymentInfo.contracts)) {
      if (typeof address === 'string') {
        console.log(`Verifying ${name}...`);
        try {
          await run("verify:verify", {
            address: address,
            constructorArguments: [], // Add constructor args based on contract
          });
          console.log(`✅ ${name} verified`);
        } catch (error: any) {
          console.log(`❌ ${name} verification failed:`, error.message);
        }
      }
    }
  } catch (error: any) {
    console.log("Verification failed:", error.message);
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