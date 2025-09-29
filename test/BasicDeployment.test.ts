import { expect } from "chai";

describe("Basic Contract Tests", function () {
  let ethers: any;
  let hre: any;

  before(async function () {
    // Import hardhat runtime environment
    hre = await import("hardhat");
    ethers = hre.ethers;
  });

  describe("Contract Deployment", function () {
    it("Should deploy SystemContract successfully", async function () {
      const SystemContractFactory = await ethers.getContractFactory("SystemContract");
      const systemContract = await SystemContractFactory.deploy();
      await systemContract.deployed();
      
      expect(systemContract.address).to.not.equal(ethers.constants.AddressZero);
    });

    it("Should deploy CrossChainYield successfully", async function () {
      const [owner] = await ethers.getSigners();
      
      const SystemContractFactory = await ethers.getContractFactory("SystemContract");
      const systemContract = await SystemContractFactory.deploy();
      await systemContract.deployed();

      const CrossChainYieldFactory = await ethers.getContractFactory("CrossChainYield");
      const crossChainYield = await CrossChainYieldFactory.deploy(
        systemContract.address,
        await owner.getAddress()
      );
      await crossChainYield.deployed();
      
      expect(crossChainYield.address).to.not.equal(ethers.constants.AddressZero);
      expect(await crossChainYield.admin()).to.equal(await owner.getAddress());
    });

    it("Should deploy BitcoinYieldVault successfully", async function () {
      const [owner, treasury] = await ethers.getSigners();
      
      const SystemContractFactory = await ethers.getContractFactory("SystemContract");
      const systemContract = await SystemContractFactory.deploy();
      await systemContract.deployed();

      const CrossChainYieldFactory = await ethers.getContractFactory("CrossChainYield");
      const crossChainYield = await CrossChainYieldFactory.deploy(
        systemContract.address,
        await owner.getAddress()
      );
      await crossChainYield.deployed();

      const BitcoinYieldVaultFactory = await ethers.getContractFactory("BitcoinYieldVault");
      const bitcoinYieldVault = await BitcoinYieldVaultFactory.deploy(
        systemContract.address,
        crossChainYield.address,
        await treasury.getAddress()
      );
      await bitcoinYieldVault.deployed();
      
      expect(bitcoinYieldVault.address).to.not.equal(ethers.constants.AddressZero);
      expect(await bitcoinYieldVault.systemContract()).to.equal(systemContract.address);
    });

    it("Should deploy CompoundAdapter successfully", async function () {
      const mockCToken = "0x1234567890123456789012345678901234567890";
      const mockComptroller = "0x2345678901234567890123456789012345678901";

      const CompoundAdapterFactory = await ethers.getContractFactory("CompoundAdapter");
      const compoundAdapter = await CompoundAdapterFactory.deploy(
        mockCToken,
        mockComptroller
      );
      await compoundAdapter.deployed();
      
      expect(compoundAdapter.address).to.not.equal(ethers.constants.AddressZero);
      expect(await compoundAdapter.cToken()).to.equal(mockCToken);
      expect(await compoundAdapter.getProtocolName()).to.equal("Compound");
    });

    it("Should deploy AaveAdapter successfully", async function () {
      const mockLendingPoolProvider = "0x3456789012345678901234567890123456789012";
      const mockAToken = "0x4567890123456789012345678901234567890123";
      const mockRewardsController = "0x5678901234567890123456789012345678901234";
      const mockRewardToken = "0x6789012345678901234567890123456789012345";

      const AaveAdapterFactory = await ethers.getContractFactory("AaveAdapter");
      const aaveAdapter = await AaveAdapterFactory.deploy(
        mockLendingPoolProvider,
        mockAToken,
        mockRewardsController,
        mockRewardToken
      );
      await aaveAdapter.deployed();
      
      expect(aaveAdapter.address).to.not.equal(ethers.constants.AddressZero);
      expect(await aaveAdapter.getProtocolName()).to.equal("Aave");
    });

    it("Should deploy PancakeSwapAdapter successfully", async function () {
      const mockRouter = "0x7890123456789012345678901234567890123456";
      const mockMasterChef = "0x8901234567890123456789012345678901234567";
      const mockLPToken = "0x9012345678901234567890123456789012345678";
      const mockCakeToken = "0x0123456789012345678901234567890123456789";
      const mockPoolId = 0;

      const PancakeSwapAdapterFactory = await ethers.getContractFactory("PancakeSwapAdapter");
      const pancakeSwapAdapter = await PancakeSwapAdapterFactory.deploy(
        mockRouter,
        mockMasterChef,
        mockLPToken,
        mockCakeToken,
        mockPoolId
      );
      await pancakeSwapAdapter.deployed();
      
      expect(pancakeSwapAdapter.address).to.not.equal(ethers.constants.AddressZero);
      expect(await pancakeSwapAdapter.getProtocolName()).to.equal("PancakeSwap");
    });

    it("Should deploy QuickSwapAdapter successfully", async function () {
      const mockRouter = "0x1123456789012345678901234567890123456789";
      const mockStakingRewards = "0x2234567890123456789012345678901234567890";
      const mockLPToken = "0x3345678901234567890123456789012345678901";
      const mockQuickToken = "0x4456789012345678901234567890123456789012";
      const mockDQuickToken = "0x5567890123456789012345678901234567890123";

      const QuickSwapAdapterFactory = await ethers.getContractFactory("QuickSwapAdapter");
      const quickSwapAdapter = await QuickSwapAdapterFactory.deploy(
        mockRouter,
        mockStakingRewards,
        mockLPToken,
        mockQuickToken,
        mockDQuickToken
      );
      await quickSwapAdapter.deployed();
      
      expect(quickSwapAdapter.address).to.not.equal(ethers.constants.AddressZero);
      expect(await quickSwapAdapter.getProtocolName()).to.equal("QuickSwap");
    });
  });

  describe("Integration Test", function () {
    it("Should set up complete system", async function () {
      const [owner, treasury, user] = await ethers.getSigners();
      
      // Deploy system contract
      const SystemContractFactory = await ethers.getContractFactory("SystemContract");
      const systemContract = await SystemContractFactory.deploy();
      await systemContract.deployed();

      // Deploy CrossChainYield
      const CrossChainYieldFactory = await ethers.getContractFactory("CrossChainYield");
      const crossChainYield = await CrossChainYieldFactory.deploy(
        systemContract.address,
        await owner.getAddress()
      );
      await crossChainYield.deployed();

      // Deploy BitcoinYieldVault
      const BitcoinYieldVaultFactory = await ethers.getContractFactory("BitcoinYieldVault");
      const bitcoinYieldVault = await BitcoinYieldVaultFactory.deploy(
        systemContract.address,
        crossChainYield.address,
        await treasury.getAddress()
      );
      await bitcoinYieldVault.deployed();

      // Authorize vault
      await crossChainYield.setAuthorizedVault(bitcoinYieldVault.address, true);
      expect(await crossChainYield.authorizedVaults(bitcoinYieldVault.address)).to.be.true;

      // Deploy an adapter
      const CompoundAdapterFactory = await ethers.getContractFactory("CompoundAdapter");
      const compoundAdapter = await CompoundAdapterFactory.deploy(
        "0x1234567890123456789012345678901234567890",
        "0x2345678901234567890123456789012345678901"
      );
      await compoundAdapter.deployed();

      // Add protocol
      await crossChainYield.addProtocol(
        compoundAdapter.address,
        "0x1234567890123456789012345678901234567890",
        1, // Ethereum
        500, // 5% APY
        "Compound Ethereum",
        ethers.utils.parseEther("0.01"), // min deposit
        ethers.utils.parseEther("100") // max deposit
      );

      expect(await crossChainYield.protocolCount()).to.equal(1);
      
      const protocolConfig = await crossChainYield.getProtocolConfig(1);
      expect(protocolConfig.protocolAdapter).to.equal(compoundAdapter.address);
      expect(protocolConfig.isActive).to.be.true;
      expect(protocolConfig.currentAPY).to.equal(500);
    });
  });
});