import { expect } from "chai";
import { ethers } from "ethers";
import { Signer } from "ethers";
import { CrossChainYield, SystemContract, CompoundAdapter } from "../typechain-types";

describe("CrossChainYield", function () {
  let crossChainYield: CrossChainYield;
  let systemContract: SystemContract;
  let compoundAdapter: CompoundAdapter;
  let owner: Signer;
  let emergencyAdmin: Signer;
  let authorizedVault: Signer;
  let user1: Signer;
  let user2: Signer;
  let addrs: Signer[];

  const CHAIN_ID_ETHEREUM = 1;
  const CHAIN_ID_BSC = 56;
  const BASIS_POINTS = 10_000;

  beforeEach(async function () {
    [owner, emergencyAdmin, authorizedVault, user1, user2, ...addrs] = await ethers.getSigners();

    // Deploy SystemContract mock
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

    // Authorize a vault
    await crossChainYield.setAuthorizedVault(await authorizedVault.getAddress(), true);
  });

  describe("Deployment", function () {
    it("Should set the correct system contract", async function () {
      expect(await crossChainYield.systemContract()).to.equal(systemContract.address);
    });

    it("Should set the correct admin", async function () {
      expect(await crossChainYield.admin()).to.equal(await owner.getAddress());
    });

    it("Should set the correct emergency admin", async function () {
      // Note: This would require adding a getter for emergencyAdmin in the contract
      // For now, we'll test indirectly through pause functionality
    });

    it("Should not be paused initially", async function () {
      expect(await crossChainYield.paused()).to.be.false;
    });

    it("Should initialize with zero protocols", async function () {
      expect(await crossChainYield.protocolCount()).to.equal(0);
      expect(await crossChainYield.totalValueLocked()).to.equal(0);
    });
  });

  describe("Protocol Management", function () {
    it("Should allow admin to add protocol", async function () {
      const adapterAddress = await addrs[0].getAddress();
      const tokenAddress = await addrs[1].getAddress();
      const apy = 500; // 5%
      const maxCapacity = ethers.utils.parseEther("1000000");
      const protocolName = "Test Protocol";

      await expect(crossChainYield.addProtocol(
        adapterAddress,
        tokenAddress,
        CHAIN_ID_ETHEREUM,
        apy,
        maxCapacity,
        protocolName
      )).to.emit(crossChainYield, "ProtocolAdded")
        .withArgs(1, adapterAddress, CHAIN_ID_ETHEREUM, protocolName);

      expect(await crossChainYield.protocolCount()).to.equal(1);

      const protocolInfo = await crossChainYield.getProtocolInfo(1);
      expect(protocolInfo.adapterAddress).to.equal(adapterAddress);
      expect(protocolInfo.chainId).to.equal(CHAIN_ID_ETHEREUM);
      expect(protocolInfo.currentAPY).to.equal(apy);
      expect(protocolInfo.isActive).to.be.true;
      expect(protocolInfo.protocolName).to.equal(protocolName);
    });

    it("Should allow admin to update protocol", async function () {
      // First add a protocol
      const adapterAddress = await addrs[0].getAddress();
      const tokenAddress = await addrs[1].getAddress();
      await crossChainYield.addProtocol(
        adapterAddress,
        tokenAddress,
        CHAIN_ID_ETHEREUM,
        500,
        ethers.utils.parseEther("1000000"),
        "Test Protocol"
      );

      const newAPY = 600;
      const isActive = false;

      await expect(crossChainYield.updateProtocol(1, newAPY, isActive))
        .to.emit(crossChainYield, "ProtocolUpdated")
        .withArgs(1, newAPY, isActive);

      const protocolInfo = await crossChainYield.getProtocolInfo(1);
      expect(protocolInfo.currentAPY).to.equal(newAPY);
      expect(protocolInfo.isActive).to.equal(isActive);
    });

    it("Should not allow non-admin to add protocol", async function () {
      const adapterAddress = await addrs[0].getAddress();
      const tokenAddress = await addrs[1].getAddress();

      await expect(crossChainYield.connect(user1).addProtocol(
        adapterAddress,
        tokenAddress,
        CHAIN_ID_ETHEREUM,
        500,
        ethers.utils.parseEther("1000000"),
        "Test Protocol"
      )).to.be.revertedWith("Only admin");
    });

    it("Should reject invalid adapter address", async function () {
      await expect(crossChainYield.addProtocol(
        ethers.constants.AddressZero,
        await addrs[1].getAddress(),
        CHAIN_ID_ETHEREUM,
        500,
        ethers.utils.parseEther("1000000"),
        "Test Protocol"
      )).to.be.revertedWith("Invalid adapter");
    });
  });

  describe("Fund Deployment", function () {
    beforeEach(async function () {
      // Add a test protocol
      const adapterAddress = await addrs[0].getAddress();
      const tokenAddress = await addrs[1].getAddress();
      await crossChainYield.addProtocol(
        adapterAddress,
        tokenAddress,
        CHAIN_ID_ETHEREUM,
        500,
        ethers.utils.parseEther("1000000"),
        "Test Protocol"
      );
    });

    it("Should allow authorized vault to deploy funds", async function () {
      const userAddress = await user1.getAddress();
      const protocolId = 1;
      const amount = ethers.utils.parseEther("100");

      await expect(crossChainYield.connect(authorizedVault).deployToProtocol(
        userAddress,
        protocolId,
        amount
      )).to.emit(crossChainYield, "CrossChainDeployment");

      const userPosition = await crossChainYield.getUserPosition(userAddress, protocolId);
      expect(userPosition.principal).to.equal(amount);
      expect(userPosition.isActive).to.be.true;
    });

    it("Should not allow unauthorized caller to deploy funds", async function () {
      const userAddress = await user1.getAddress();
      const protocolId = 1;
      const amount = ethers.utils.parseEther("100");

      await expect(crossChainYield.connect(user1).deployToProtocol(
        userAddress,
        protocolId,
        amount
      )).to.be.revertedWith("Not authorized");
    });

    it("Should reject deployment to inactive protocol", async function () {
      // Deactivate the protocol
      await crossChainYield.updateProtocol(1, 500, false);

      const userAddress = await user1.getAddress();
      const protocolId = 1;
      const amount = ethers.utils.parseEther("100");

      await expect(crossChainYield.connect(authorizedVault).deployToProtocol(
        userAddress,
        protocolId,
        amount
      )).to.be.revertedWith("Protocol not active");
    });

    it("Should reject zero amount deployment", async function () {
      const userAddress = await user1.getAddress();
      const protocolId = 1;

      await expect(crossChainYield.connect(authorizedVault).deployToProtocol(
        userAddress,
        protocolId,
        0
      )).to.be.revertedWith("Amount must be greater than 0");
    });

    it("Should reject deployment exceeding protocol capacity", async function () {
      const userAddress = await user1.getAddress();
      const protocolId = 1;
      const excessiveAmount = ethers.utils.parseEther("2000000"); // Exceeds 1M capacity

      await expect(crossChainYield.connect(authorizedVault).deployToProtocol(
        userAddress,
        protocolId,
        excessiveAmount
      )).to.be.revertedWith("Exceeds protocol capacity");
    });
  });

  describe("Fund Withdrawal", function () {
    beforeEach(async function () {
      // Add protocol and deploy funds
      const adapterAddress = await addrs[0].getAddress();
      const tokenAddress = await addrs[1].getAddress();
      await crossChainYield.addProtocol(
        adapterAddress,
        tokenAddress,
        CHAIN_ID_ETHEREUM,
        500,
        ethers.utils.parseEther("1000000"),
        "Test Protocol"
      );

      const userAddress = await user1.getAddress();
      const amount = ethers.utils.parseEther("100");
      await crossChainYield.connect(authorizedVault).deployToProtocol(
        userAddress,
        1,
        amount
      );
    });

    it("Should allow withdrawal from protocol", async function () {
      const userAddress = await user1.getAddress();
      const protocolId = 1;
      const withdrawAmount = ethers.utils.parseEther("50");

      await expect(crossChainYield.connect(authorizedVault).withdrawFromProtocol(
        userAddress,
        protocolId,
        withdrawAmount
      )).to.emit(crossChainYield, "CrossChainWithdrawal");
    });

    it("Should allow full withdrawal (amount = 0)", async function () {
      const userAddress = await user1.getAddress();
      const protocolId = 1;

      await expect(crossChainYield.connect(authorizedVault).withdrawFromProtocol(
        userAddress,
        protocolId,
        0
      )).to.emit(crossChainYield, "CrossChainWithdrawal");
    });

    it("Should reject withdrawal with insufficient balance", async function () {
      const userAddress = await user1.getAddress();
      const protocolId = 1;
      const excessiveAmount = ethers.utils.parseEther("200"); // More than deposited

      await expect(crossChainYield.connect(authorizedVault).withdrawFromProtocol(
        userAddress,
        protocolId,
        excessiveAmount
      )).to.be.revertedWith("Insufficient balance");
    });

    it("Should reject withdrawal from user with no position", async function () {
      const userAddress = await user2.getAddress(); // Different user
      const protocolId = 1;

      await expect(crossChainYield.connect(authorizedVault).withdrawFromProtocol(
        userAddress,
        protocolId,
        ethers.utils.parseEther("50")
      )).to.be.revertedWith("No active position");
    });
  });

  describe("Yield Harvesting", function () {
    beforeEach(async function () {
      // Add protocol and deploy funds
      const adapterAddress = await addrs[0].getAddress();
      const tokenAddress = await addrs[1].getAddress();
      await crossChainYield.addProtocol(
        adapterAddress,
        tokenAddress,
        CHAIN_ID_ETHEREUM,
        500,
        ethers.utils.parseEther("1000000"),
        "Test Protocol"
      );

      const userAddress = await user1.getAddress();
      const amount = ethers.utils.parseEther("100");
      await crossChainYield.connect(authorizedVault).deployToProtocol(
        userAddress,
        1,
        amount
      );
    });

    it("Should allow yield harvesting", async function () {
      const userAddress = await user1.getAddress();
      const protocolId = 1;

      // Note: In a real test, we'd need to simulate time passage and yield accrual
      // For now, we test the basic functionality
      await expect(crossChainYield.connect(authorizedVault).harvestYield(
        userAddress,
        protocolId
      )).to.emit(crossChainYield, "YieldHarvested");
    });

    it("Should not allow unauthorized harvest", async function () {
      const userAddress = await user1.getAddress();
      const protocolId = 1;

      await expect(crossChainYield.connect(user1).harvestYield(
        userAddress,
        protocolId
      )).to.be.revertedWith("Not authorized");
    });
  });

  describe("Protocol Rebalancing", function () {
    beforeEach(async function () {
      // Add two protocols
      const adapter1 = await addrs[0].getAddress();
      const adapter2 = await addrs[1].getAddress();
      const token1 = await addrs[2].getAddress();
      const token2 = await addrs[3].getAddress();

      await crossChainYield.addProtocol(
        adapter1,
        token1,
        CHAIN_ID_ETHEREUM,
        500,
        ethers.utils.parseEther("1000000"),
        "Protocol 1"
      );

      await crossChainYield.addProtocol(
        adapter2,
        token2,
        CHAIN_ID_BSC,
        700,
        ethers.utils.parseEther("1000000"),
        "Protocol 2"
      );

      // Deploy funds to first protocol
      const userAddress = await user1.getAddress();
      const amount = ethers.utils.parseEther("100");
      await crossChainYield.connect(authorizedVault).deployToProtocol(
        userAddress,
        1,
        amount
      );
    });

    it("Should allow rebalancing between protocols", async function () {
      const userAddress = await user1.getAddress();
      const fromProtocol = 1;
      const toProtocol = 2;
      const amount = ethers.utils.parseEther("50");

      await expect(crossChainYield.connect(authorizedVault).rebalanceProtocols(
        userAddress,
        fromProtocol,
        toProtocol,
        amount
      )).to.emit(crossChainYield, "Rebalancing");
    });

    it("Should reject rebalancing to same protocol", async function () {
      const userAddress = await user1.getAddress();
      const protocolId = 1;
      const amount = ethers.utils.parseEther("50");

      await expect(crossChainYield.connect(authorizedVault).rebalanceProtocols(
        userAddress,
        protocolId,
        protocolId,
        amount
      )).to.be.revertedWith("Same protocol");
    });

    it("Should reject rebalancing with insufficient balance", async function () {
      const userAddress = await user1.getAddress();
      const fromProtocol = 1;
      const toProtocol = 2;
      const excessiveAmount = ethers.utils.parseEther("200");

      await expect(crossChainYield.connect(authorizedVault).rebalanceProtocols(
        userAddress,
        fromProtocol,
        toProtocol,
        excessiveAmount
      )).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Best Protocol Selection", function () {
    beforeEach(async function () {
      // Add multiple protocols with different APYs
      const protocols = [
        { apy: 300, chain: CHAIN_ID_ETHEREUM, name: "Low APY" },
        { apy: 800, chain: CHAIN_ID_BSC, name: "High APY" },
        { apy: 500, chain: CHAIN_ID_ETHEREUM, name: "Medium APY" }
      ];

      for (let i = 0; i < protocols.length; i++) {
        const adapter = await addrs[i].getAddress();
        const token = await addrs[i + 3].getAddress();
        
        await crossChainYield.addProtocol(
          adapter,
          token,
          protocols[i].chain,
          protocols[i].apy,
          ethers.utils.parseEther("1000000"),
          protocols[i].name
        );
      }
    });

    it("Should return protocol with highest APY", async function () {
      const bestProtocol = await crossChainYield.getBestProtocol(0); // No chain filter
      expect(bestProtocol).to.equal(2); // Protocol with 800 APY
    });

    it("Should filter by chain when specified", async function () {
      const bestProtocol = await crossChainYield.getBestProtocol(CHAIN_ID_ETHEREUM);
      expect(bestProtocol).to.equal(3); // Best Ethereum protocol (500 APY)
    });

    it("Should return 0 if no protocols available", async function () {
      // Deactivate all protocols
      await crossChainYield.updateProtocol(1, 300, false);
      await crossChainYield.updateProtocol(2, 800, false);
      await crossChainYield.updateProtocol(3, 500, false);

      const bestProtocol = await crossChainYield.getBestProtocol(0);
      expect(bestProtocol).to.equal(0);
    });
  });

  describe("Access Control", function () {
    it("Should allow admin to set authorized vault", async function () {
      const newVault = await addrs[0].getAddress();
      
      await crossChainYield.setAuthorizedVault(newVault, true);
      // We'd need a getter to test this properly, but we can test indirectly
    });

    it("Should allow admin to set chain ZRC20 mapping", async function () {
      const chainId = CHAIN_ID_ETHEREUM;
      const zrc20Address = await addrs[0].getAddress();
      
      await crossChainYield.setChainZRC20(chainId, zrc20Address);
      expect(await crossChainYield.chainToZRC20(chainId)).to.equal(zrc20Address);
    });

    it("Should allow admin to pause contract", async function () {
      await crossChainYield.pause();
      expect(await crossChainYield.paused()).to.be.true;
    });

    it("Should allow admin to unpause contract", async function () {
      await crossChainYield.pause();
      await crossChainYield.unpause();
      expect(await crossChainYield.paused()).to.be.false;
    });

    it("Should not allow non-admin to pause", async function () {
      await expect(crossChainYield.connect(user1).pause())
        .to.be.revertedWith("Only emergency admin allowed");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      // Add protocol and deploy funds
      const adapterAddress = await addrs[0].getAddress();
      const tokenAddress = await addrs[1].getAddress();
      await crossChainYield.addProtocol(
        adapterAddress,
        tokenAddress,
        CHAIN_ID_ETHEREUM,
        500,
        ethers.utils.parseEther("1000000"),
        "Test Protocol"
      );

      const userAddress = await user1.getAddress();
      const amount = ethers.utils.parseEther("100");
      await crossChainYield.connect(authorizedVault).deployToProtocol(
        userAddress,
        1,
        amount
      );
    });

    it("Should return correct user position", async function () {
      const userAddress = await user1.getAddress();
      const position = await crossChainYield.getUserPosition(userAddress, 1);
      
      expect(position.principal).to.equal(ethers.utils.parseEther("100"));
      expect(position.isActive).to.be.true;
    });

    it("Should return correct protocol configuration", async function () {
      const config = await crossChainYield.getProtocolConfig(1);
      
      expect(config.adapterAddress).to.equal(await addrs[0].getAddress());
      expect(config.chainId).to.equal(CHAIN_ID_ETHEREUM);
      expect(config.currentAPY).to.equal(500);
      expect(config.isActive).to.be.true;
      expect(config.protocolName).to.equal("Test Protocol");
    });

    it("Should return correct vault statistics", async function () {
      const stats = await crossChainYield.getVaultStats();
      
      expect(stats.totalTvl).to.equal(ethers.utils.parseEther("100"));
      expect(stats.activeProtocols).to.equal(1);
    });
  });
});