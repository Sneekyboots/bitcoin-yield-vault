import { expect } from "chai";
import { ethers } from "ethers";
import hre from "hardhat";
import { Signer } from "ethers";

describe("BitcoinYieldVault - Basic Tests", function () {
  let bitcoinYieldVault: any;
  let crossChainYield: any;
  let systemContract: any;
  let owner: Signer;
  let treasury: Signer;
  let emergencyAdmin: Signer;
  let user1: Signer;
  let user2: Signer;

  beforeEach(async function () {
    [owner, treasury, emergencyAdmin, user1, user2] = await ethers.getSigners();

    // Deploy SystemContract interface (using our local interface)
    const SystemContractFactory = await ethers.getContractFactory("SystemContract");
    systemContract = await SystemContractFactory.deploy();
    await systemContract.deployed();

    // Deploy CrossChainYield
    const CrossChainYieldFactory = await ethers.getContractFactory("CrossChainYield");
    crossChainYield = await CrossChainYieldFactory.deploy(
      systemContract.address,
      await emergencyAdmin.getAddress()
    );
    await crossChainYield.deployed();

    // Deploy BitcoinYieldVault
    const BitcoinYieldVaultFactory = await ethers.getContractFactory("BitcoinYieldVault");
    bitcoinYieldVault = await BitcoinYieldVaultFactory.deploy(
      systemContract.address,
      crossChainYield.address,
      await treasury.getAddress()
    );
    await bitcoinYieldVault.deployed();

    // Set up basic configuration
    await crossChainYield.setAuthorizedVault(bitcoinYieldVault.address, true);
  });

  describe("Deployment", function () {
    it("Should deploy successfully", async function () {
      expect(bitcoinYieldVault.address).to.not.equal(ethers.constants.AddressZero);
      expect(crossChainYield.address).to.not.equal(ethers.constants.AddressZero);
      expect(systemContract.address).to.not.equal(ethers.constants.AddressZero);
    });

    it("Should set the correct system contract", async function () {
      expect(await bitcoinYieldVault.systemContract()).to.equal(systemContract.address);
    });

    it("Should have CrossChainYield properly configured", async function () {
      expect(await crossChainYield.systemContract()).to.equal(systemContract.address);
      expect(await crossChainYield.admin()).to.equal(await owner.getAddress());
    });

    it("Should have vault authorized in CrossChainYield", async function () {
      expect(await crossChainYield.authorizedVaults(bitcoinYieldVault.address)).to.be.true;
    });
  });

  describe("CrossChainYield Protocol Management", function () {
    it("Should allow admin to add protocols", async function () {
      const protocolAddress = await user1.getAddress(); // Mock protocol adapter
      const tokenAddress = await user2.getAddress(); // Mock token
      const chainId = 1;
      const apy = 500; // 5%
      const protocolName = "Test Protocol";
      const minDeposit = ethers.utils.parseEther("0.01");
      const maxDeposit = ethers.utils.parseEther("100");

      await expect(
        crossChainYield.addProtocol(
          protocolAddress,
          tokenAddress,
          chainId,
          apy,
          protocolName,
          minDeposit,
          maxDeposit
        )
      ).to.emit(crossChainYield, "ProtocolAdded");

      expect(await crossChainYield.protocolCount()).to.equal(1);
    });

    it("Should return correct protocol configuration", async function () {
      // Add a protocol first
      const protocolAddress = await user1.getAddress();
      const tokenAddress = await user2.getAddress();
      const chainId = 1;
      const apy = 500;
      const protocolName = "Test Protocol";
      const minDeposit = ethers.utils.parseEther("0.01");
      const maxDeposit = ethers.utils.parseEther("100");

      await crossChainYield.addProtocol(
        protocolAddress,
        tokenAddress,
        chainId,
        apy,
        protocolName,
        minDeposit,
        maxDeposit
      );

      const protocolConfig = await crossChainYield.getProtocolConfig(1);
      expect(protocolConfig.protocolAdapter).to.equal(protocolAddress);
      expect(protocolConfig.tokenAddress).to.equal(tokenAddress);
      expect(protocolConfig.chainId).to.equal(chainId);
      expect(protocolConfig.currentAPY).to.equal(apy);
      expect(protocolConfig.isActive).to.be.true;
    });

    it("Should allow protocol updates", async function () {
      // Add a protocol first
      await crossChainYield.addProtocol(
        await user1.getAddress(),
        await user2.getAddress(),
        1,
        500,
        "Test Protocol",
        ethers.utils.parseEther("0.01"),
        ethers.utils.parseEther("100")
      );

      const newAPY = 600;
      const isActive = false;
      const autoCompound = false;

      await expect(
        crossChainYield.updateProtocol(1, newAPY, isActive, autoCompound)
      ).to.emit(crossChainYield, "ProtocolUpdated");

      const updatedConfig = await crossChainYield.getProtocolConfig(1);
      expect(updatedConfig.currentAPY).to.equal(newAPY);
      expect(updatedConfig.isActive).to.equal(isActive);
      expect(updatedConfig.autoCompound).to.equal(autoCompound);
    });

    it("Should not allow non-admin to add protocols", async function () {
      await expect(
        crossChainYield.connect(user1).addProtocol(
          await user1.getAddress(),
          await user2.getAddress(),
          1,
          500,
          "Test Protocol",
          ethers.utils.parseEther("0.01"),
          ethers.utils.parseEther("100")
        )
      ).to.be.revertedWith("Only admin allowed");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to set ZRC20 mappings", async function () {
      const chainId = 1;
      const zrc20Address = await user1.getAddress();

      await crossChainYield.setChainZRC20(chainId, zrc20Address);
      expect(await crossChainYield.chainToZRC20(chainId)).to.equal(zrc20Address);
    });

    it("Should allow admin to authorize vaults", async function () {
      const newVault = await user1.getAddress();

      await crossChainYield.setAuthorizedVault(newVault, true);
      expect(await crossChainYield.authorizedVaults(newVault)).to.be.true;

      await crossChainYield.setAuthorizedVault(newVault, false);
      expect(await crossChainYield.authorizedVaults(newVault)).to.be.false;
    });

    it("Should allow admin to set parameters", async function () {
      const newSlippage = 500; // 5%
      const newMaxRetries = 5;

      await crossChainYield.setParameters(newSlippage, newMaxRetries);
      expect(await crossChainYield.defaultSlippage()).to.equal(newSlippage);
      expect(await crossChainYield.maxRetries()).to.equal(newMaxRetries);
    });

    it("Should allow admin to pause and unpause", async function () {
      expect(await crossChainYield.paused()).to.be.false;

      await crossChainYield.pause();
      expect(await crossChainYield.paused()).to.be.true;

      await crossChainYield.unpause();
      expect(await crossChainYield.paused()).to.be.false;
    });

    it("Should not allow non-admin to call admin functions", async function () {
      await expect(
        crossChainYield.connect(user1).setChainZRC20(1, await user1.getAddress())
      ).to.be.revertedWith("Only admin allowed");

      await expect(
        crossChainYield.connect(user1).setParameters(500, 5)
      ).to.be.revertedWith("Only admin allowed");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      // Add some test protocols
      await crossChainYield.addProtocol(
        await user1.getAddress(),
        await user2.getAddress(),
        1,
        500,
        "Protocol 1",
        ethers.utils.parseEther("0.01"),
        ethers.utils.parseEther("100")
      );

      await crossChainYield.addProtocol(
        await user2.getAddress(),
        await user1.getAddress(),
        1,
        600,
        "Protocol 2",
        ethers.utils.parseEther("0.01"),
        ethers.utils.parseEther("200")
      );
    });

    it("Should return correct vault statistics", async function () {
      const stats = await crossChainYield.getVaultStats();
      expect(stats.totalTvl).to.equal(0); // No deposits yet
      expect(stats.totalHarvested).to.equal(0); // No harvests yet
      expect(stats.activeProtocols).to.equal(2); // Both protocols are active
    });

    it("Should find best protocol by APY", async function () {
      const bestProtocol = await crossChainYield.getBestProtocol(0); // 0 = any chain
      expect(bestProtocol).to.equal(2); // Protocol 2 has higher APY (600 vs 500)
    });

    it("Should return chain protocols", async function () {
      const chainProtocols = await crossChainYield.getChainProtocols(1);
      expect(chainProtocols.length).to.equal(2);
      expect(chainProtocols[0]).to.equal(1);
      expect(chainProtocols[1]).to.equal(2);
    });
  });

  describe("Integration", function () {
    it("Should handle protocol deployment workflow", async function () {
      // This test simulates the basic workflow without actual cross-chain calls
      
      // 1. Add protocol
      await crossChainYield.addProtocol(
        await user1.getAddress(),
        await user2.getAddress(),
        1,
        500,
        "Test Protocol",
        ethers.utils.parseEther("0.01"),
        ethers.utils.parseEther("100")
      );

      // 2. Set ZRC20 mapping
      await crossChainYield.setChainZRC20(1, await user2.getAddress());

      // 3. Verify setup
      const protocolConfig = await crossChainYield.getProtocolConfig(1);
      expect(protocolConfig.isActive).to.be.true;
      
      const zrc20 = await crossChainYield.chainToZRC20(1);
      expect(zrc20).to.equal(await user2.getAddress());
    });
  });
});