import { expect } from "chai";
import { ethers } from "ethers";
import hre from "hardhat";
import { Signer } from "ethers";

describe("Protocol Adapters - Basic Tests", function () {
  let compoundAdapter: any;
  let owner: Signer;
  let user1: Signer;

  // Mock addresses for testing
  const mockCToken = "0x1234567890123456789012345678901234567890";
  const mockComptroller = "0x2345678901234567890123456789012345678901";

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();
  });

  describe("CompoundAdapter", function () {
    it("Should deploy successfully", async function () {
      const CompoundAdapterFactory = await ethers.getContractFactory("CompoundAdapter");
      
      compoundAdapter = await CompoundAdapterFactory.deploy(
        mockCToken,
        mockComptroller
      );
      
      await compoundAdapter.deployed();
      expect(compoundAdapter.address).to.not.equal(ethers.constants.AddressZero);
    });

    it("Should return protocol name", async function () {
      const CompoundAdapterFactory = await ethers.getContractFactory("CompoundAdapter");
      compoundAdapter = await CompoundAdapterFactory.deploy(mockCToken, mockComptroller);
      await compoundAdapter.deployed();

      const protocolName = await compoundAdapter.getProtocolName();
      expect(protocolName).to.equal("Compound");
    });

    it("Should have correct initial configuration", async function () {
      const CompoundAdapterFactory = await ethers.getContractFactory("CompoundAdapter");
      compoundAdapter = await CompoundAdapterFactory.deploy(mockCToken, mockComptroller);
      await compoundAdapter.deployed();

      expect(await compoundAdapter.cToken()).to.equal(mockCToken);
      expect(await compoundAdapter.comptroller()).to.equal(mockComptroller);
    });
  });

  describe("AaveAdapter", function () {
    const mockLendingPoolProvider = "0x3456789012345678901234567890123456789012";
    const mockAToken = "0x4567890123456789012345678901234567890123";
    const mockRewardsController = "0x5678901234567890123456789012345678901234";
    const mockRewardToken = "0x6789012345678901234567890123456789012345";

    it("Should deploy successfully", async function () {
      const AaveAdapterFactory = await ethers.getContractFactory("AaveAdapter");
      
      const aaveAdapter = await AaveAdapterFactory.deploy(
        mockLendingPoolProvider,
        mockAToken,
        mockRewardsController,
        mockRewardToken
      );
      
      await aaveAdapter.deployed();
      expect(aaveAdapter.address).to.not.equal(ethers.constants.AddressZero);
    });

    it("Should return protocol name", async function () {
      const AaveAdapterFactory = await ethers.getContractFactory("AaveAdapter");
      const aaveAdapter = await AaveAdapterFactory.deploy(
        mockLendingPoolProvider,
        mockAToken,
        mockRewardsController,
        mockRewardToken
      );
      await aaveAdapter.deployed();

      const protocolName = await aaveAdapter.getProtocolName();
      expect(protocolName).to.equal("Aave");
    });
  });

  describe("PancakeSwapAdapter", function () {
    const mockRouter = "0x7890123456789012345678901234567890123456";
    const mockMasterChef = "0x8901234567890123456789012345678901234567";
    const mockLPToken = "0x9012345678901234567890123456789012345678";
    const mockCakeToken = "0x0123456789012345678901234567890123456789";
    const mockPoolId = 0;

    it("Should deploy successfully", async function () {
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
    });

    it("Should return protocol name", async function () {
      const PancakeSwapAdapterFactory = await ethers.getContractFactory("PancakeSwapAdapter");
      const pancakeSwapAdapter = await PancakeSwapAdapterFactory.deploy(
        mockRouter,
        mockMasterChef,
        mockLPToken,
        mockCakeToken,
        mockPoolId
      );
      await pancakeSwapAdapter.deployed();

      const protocolName = await pancakeSwapAdapter.getProtocolName();
      expect(protocolName).to.equal("PancakeSwap");
    });
  });

  describe("QuickSwapAdapter", function () {
    const mockRouter = "0x1123456789012345678901234567890123456789";
    const mockStakingRewards = "0x2234567890123456789012345678901234567890";
    const mockLPToken = "0x3345678901234567890123456789012345678901";
    const mockQuickToken = "0x4456789012345678901234567890123456789012";
    const mockDQuickToken = "0x5567890123456789012345678901234567890123";

    it("Should deploy successfully", async function () {
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
    });

    it("Should return protocol name", async function () {
      const QuickSwapAdapterFactory = await ethers.getContractFactory("QuickSwapAdapter");
      const quickSwapAdapter = await QuickSwapAdapterFactory.deploy(
        mockRouter,
        mockStakingRewards,
        mockLPToken,
        mockQuickToken,
        mockDQuickToken
      );
      await quickSwapAdapter.deployed();

      const protocolName = await quickSwapAdapter.getProtocolName();
      expect(protocolName).to.equal("QuickSwap");
    });
  });
});