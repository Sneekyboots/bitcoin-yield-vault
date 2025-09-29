import { expect } from "chai";

describe("Bitcoin Yield Vault Integration Tests", function () {
  let ethers: any;
  let hre: any;
  let systemContract: any;
  let crossChainYield: any;
  let bitcoinYieldVault: any;
  let compoundAdapter: any;
  let aaveAdapter: any;
  let pancakeSwapAdapter: any;
  let quickSwapAdapter: any;
  let deployer: any;
  let treasury: any;
  let user: any;

  before(async function () {
    // Import hardhat runtime environment
    hre = await import("hardhat");
    ethers = hre.ethers;
    
    [deployer, treasury, user] = await ethers.getSigners();
  });

  describe("Complete System Deployment", function () {
    it("Should deploy all contracts successfully", async function () {
      // Deploy SystemContract
      const SystemContractFactory = await ethers.getContractFactory("SystemContract");
      systemContract = await SystemContractFactory.deploy();
      await systemContract.deployed();
      
      expect(systemContract.address).to.not.equal(ethers.constants.AddressZero);
      console.log("SystemContract deployed to:", systemContract.address);

      // Deploy CrossChainYield
      const CrossChainYieldFactory = await ethers.getContractFactory("CrossChainYield");
      crossChainYield = await CrossChainYieldFactory.deploy(
        systemContract.address,
        deployer.address
      );
      await crossChainYield.deployed();
      
      expect(crossChainYield.address).to.not.equal(ethers.constants.AddressZero);
      console.log("CrossChainYield deployed to:", crossChainYield.address);

      // Deploy BitcoinYieldVault
      const BitcoinYieldVaultFactory = await ethers.getContractFactory("BitcoinYieldVault");
      bitcoinYieldVault = await BitcoinYieldVaultFactory.deploy(
        systemContract.address,
        crossChainYield.address,
        treasury.address
      );
      await bitcoinYieldVault.deployed();
      
      expect(bitcoinYieldVault.address).to.not.equal(ethers.constants.AddressZero);
      console.log("BitcoinYieldVault deployed to:", bitcoinYieldVault.address);

      // Authorize vault
      await crossChainYield.setAuthorizedVault(bitcoinYieldVault.address, true);
      expect(await crossChainYield.authorizedVaults(bitcoinYieldVault.address)).to.be.true;
    });

    it("Should deploy all protocol adapters", async function () {
      // Deploy CompoundAdapter
      const CompoundAdapterFactory = await ethers.getContractFactory("CompoundAdapter");
      compoundAdapter = await CompoundAdapterFactory.deploy(
        "0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5", // cETH
        "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B"  // Comptroller
      );
      await compoundAdapter.deployed();
      console.log("CompoundAdapter deployed to:", compoundAdapter.address);

      // Deploy AaveAdapter
      const AaveAdapterFactory = await ethers.getContractFactory("AaveAdapter");
      aaveAdapter = await AaveAdapterFactory.deploy(
        "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9", // LendingPoolAddressesProvider
        "0x028171bCA77440897B824Ca71D1c56caC55b68A3", // aDAI
        "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5", // IncentivesController
        "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9"  // AAVE token
      );
      await aaveAdapter.deployed();
      console.log("AaveAdapter deployed to:", aaveAdapter.address);

      // Deploy PancakeSwapAdapter
      const PancakeSwapAdapterFactory = await ethers.getContractFactory("PancakeSwapAdapter");
      pancakeSwapAdapter = await PancakeSwapAdapterFactory.deploy(
        "0x10ED43C718714eb63d5aA57B78B54704E256024E", // Router
        "0xa5f8C5Dbd5F286960b9d90548680aE5ebFf07652", // MasterChef
        "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0", // LP Token
        "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", // CAKE token
        251 // Pool ID
      );
      await pancakeSwapAdapter.deployed();
      console.log("PancakeSwapAdapter deployed to:", pancakeSwapAdapter.address);

      // Deploy QuickSwapAdapter
      const QuickSwapAdapterFactory = await ethers.getContractFactory("QuickSwapAdapter");
      quickSwapAdapter = await QuickSwapAdapterFactory.deploy(
        "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // Router
        "0x8eC6C5C632e9aB8e7a7b1e6c2b5c5F5Dc5B5B5B5", // StakingRewards
        "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", // LP Token
        "0x831753DD7087CaC61aB5644b308642cc1c33Dc13", // QUICK token
        "0x958d208Cdf087843e9AD98d23823d32E17d723A1"  // dQUICK token
      );
      await quickSwapAdapter.deployed();
      console.log("QuickSwapAdapter deployed to:", quickSwapAdapter.address);
    });

    it("Should add all protocols to CrossChainYield", async function () {
      // Add Compound protocol
      await crossChainYield.addProtocol(
        compoundAdapter.address,
        "0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5", // cETH
        1, // Ethereum
        500, // 5% APY
        "Compound Ethereum",
        ethers.utils.parseEther("0.01"), // Min deposit
        ethers.utils.parseEther("100")   // Max deposit
      );

      // Add Aave protocol
      await crossChainYield.addProtocol(
        aaveAdapter.address,
        "0x028171bCA77440897B824Ca71D1c56caC55b68A3", // aDAI
        1, // Ethereum
        300, // 3% APY
        "Aave Ethereum",
        ethers.utils.parseEther("0.01"), // Min deposit
        ethers.utils.parseEther("200")   // Max deposit
      );

      // Add PancakeSwap protocol
      await crossChainYield.addProtocol(
        pancakeSwapAdapter.address,
        "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0", // LP Token
        56, // BSC
        1500, // 15% APY
        "PancakeSwap BSC",
        ethers.utils.parseEther("0.01"), // Min deposit
        ethers.utils.parseEther("50")    // Max deposit
      );

      // Add QuickSwap protocol
      await crossChainYield.addProtocol(
        quickSwapAdapter.address,
        "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", // LP Token
        137, // Polygon
        2000, // 20% APY
        "QuickSwap Polygon",
        ethers.utils.parseEther("0.01"), // Min deposit
        ethers.utils.parseEther("75")    // Max deposit
      );

      // Verify protocol count
      const protocolCount = await crossChainYield.protocolCount();
      expect(protocolCount).to.equal(4);
      console.log("Total protocols added:", protocolCount.toString());
    });

    it("Should configure system parameters", async function () {
      // Set parameters
      await crossChainYield.setParameters(300, 3); // 3% slippage, 3 max retries

      console.log("System configured with 3% slippage and 3 max retries");
    });

    it("Should verify system state", async function () {
      // Check vault stats
      const stats = await crossChainYield.getVaultStats();
      console.log("Vault Stats:");
      console.log("- Total TVL:", stats.totalTvl.toString());
      console.log("- Active Protocols:", stats.activeProtocols.toString());

      expect(stats.activeProtocols).to.equal(4);

      // Check individual protocols
      const protocolCount = await crossChainYield.protocolCount();
      for (let i = 0; i < protocolCount; i++) {
        const protocol = await crossChainYield.protocols(i);
        console.log(`Protocol ${i}: ${protocol.name} (Chain: ${protocol.chainId}, APY: ${protocol.apy / 100}%)`);
        expect(protocol.active).to.be.true;
      }
    });
  });

  describe("System Functionality", function () {
    it("Should handle admin functions", async function () {
      // Test emergency pause
      await bitcoinYieldVault.emergencyPause();
      expect(await bitcoinYieldVault.paused()).to.be.true;

      await bitcoinYieldVault.emergencyUnpause();
      expect(await bitcoinYieldVault.paused()).to.be.false;

      console.log("Emergency pause/unpause functionality verified");
    });

    it("Should manage protocols", async function () {
      // Disable first protocol
      await crossChainYield.setProtocolStatus(0, false);
      
      const protocol = await crossChainYield.protocols(0);
      expect(protocol.active).to.be.false;

      // Re-enable protocol
      await crossChainYield.setProtocolStatus(0, true);
      
      const protocolAfter = await crossChainYield.protocols(0);
      expect(protocolAfter.active).to.be.true;

      console.log("Protocol status management verified");
    });

    it("Should validate view functions", async function () {
      // Test treasury balance check
      const treasuryBalance = await bitcoinYieldVault.getTreasuryBalance();
      console.log("Treasury balance:", treasuryBalance.toString());

      // Test protocol information
      const protocolInfo = await crossChainYield.getProtocolInfo(0);
      console.log("Protocol 0 info:", {
        name: protocolInfo.name,
        apy: protocolInfo.apy.toString(),
        chainId: protocolInfo.chainId.toString()
      });

      expect(protocolInfo.name).to.not.be.empty;
    });
  });

  describe("System Limits and Validation", function () {
    it("Should respect protocol limits", async function () {
      const protocol = await crossChainYield.protocols(0);
      
      expect(protocol.minDeposit).to.equal(ethers.utils.parseEther("0.01"));
      expect(protocol.maxDeposit.gt(protocol.minDeposit)).to.be.true;

      console.log("Protocol limits validated:", {
        min: ethers.utils.formatEther(protocol.minDeposit),
        max: ethers.utils.formatEther(protocol.maxDeposit)
      });
    });

    it("Should maintain system integrity", async function () {
      // Verify all critical addresses are set
      expect(await bitcoinYieldVault.systemContract()).to.equal(systemContract.address);
      expect(await bitcoinYieldVault.crossChainYield()).to.equal(crossChainYield.address);
      expect(await bitcoinYieldVault.treasury()).to.equal(treasury.address);

      console.log("System integrity verified - all addresses properly set");
    });
  });
});