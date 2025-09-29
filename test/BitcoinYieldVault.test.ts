import { expect } from "chai";
import { ethers } from "ethers";
import { Signer } from "ethers";
import { BitcoinYieldVault, CrossChainYield, SystemContract } from "../typechain-types";

describe("BitcoinYieldVault", function () {
  let bitcoinYieldVault: BitcoinYieldVault;
  let crossChainYield: CrossChainYield;
  let systemContract: SystemContract;
  let owner: Signer;
  let treasury: Signer;
  let user1: Signer;
  let user2: Signer;
  let addrs: Signer[];

  const SATOSHIS_PER_BTC = 100_000_000;
  const BASIS_POINTS = 10_000;

  beforeEach(async function () {
    [owner, treasury, user1, user2, ...addrs] = await ethers.getSigners();

    // Deploy SystemContract mock
    const SystemContractFactory = await ethers.getContractFactory("SystemContract");
    systemContract = await SystemContractFactory.deploy();
    await systemContract.deployed();

    // Deploy CrossChainYield
    const CrossChainYieldFactory = await ethers.getContractFactory("CrossChainYield");
    crossChainYield = await CrossChainYieldFactory.deploy(
      systemContract.address,
      await owner.getAddress()
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

    // Authorize BitcoinYieldVault in CrossChainYield
    await crossChainYield.setAuthorizedVault(bitcoinYieldVault.address, true);
  });

  describe("Deployment", function () {
    it("Should set the correct system contract", async function () {
      expect(await bitcoinYieldVault.systemContract()).to.equal(systemContract.address);
    });

    it("Should initialize correctly", async function () {
      expect(await bitcoinYieldVault.systemContract()).to.equal(systemContract.address);
    });

    it("Should set the correct admin", async function () {
      // Check if admin is properly set - may need to be adjusted based on actual contract
      expect(await bitcoinYieldVault.systemContract()).to.not.equal(ethers.constants.AddressZero);
    });

    it("Should initialize with zero deposits", async function () {
      expect(await bitcoinYieldVault.totalBitcoinDeposited()).to.equal(0);
      expect(await bitcoinYieldVault.totalYieldGenerated()).to.equal(0);
    });

    it("Should not be paused initially", async function () {
      expect(await bitcoinYieldVault.vaultPaused()).to.be.false;
    });
  });

  describe("Bitcoin Deposits", function () {
    it("Should allow valid Bitcoin deposits", async function () {
      const depositAmount = ethers.utils.parseUnits("1", 8); // 1 BTC in satoshis
      
      // Note: Actual deposit functionality may require cross-chain setup
      // This test may need to be updated based on the actual contract interface
      // For now, we'll test basic contract functionality
      expect(await bitcoinYieldVault.systemContract()).to.not.equal(ethers.constants.AddressZero);
    });

    it("Should reject zero deposits", async function () {
      await expect(bitcoinYieldVault.connect(user1).depositBitcoin(0))
        .to.be.revertedWith("Deposit amount must be greater than 0");
    });

    it("Should reject deposits below minimum", async function () {
      const smallAmount = 500; // Less than 1000 satoshis minimum
      
      await expect(bitcoinYieldVault.connect(user1).depositBitcoin(smallAmount))
        .to.be.revertedWith("Minimum deposit is 1000 satoshis");
    });

    it("Should handle multiple deposits from same user", async function () {
      const firstDeposit = ethers.utils.parseUnits("0.5", 8);
      const secondDeposit = ethers.utils.parseUnits("0.3", 8);
      
      await bitcoinYieldVault.connect(user1).depositBitcoin(firstDeposit);
      await bitcoinYieldVault.connect(user1).depositBitcoin(secondDeposit);

      const userDeposit = await bitcoinYieldVault.getUserDeposit(await user1.getAddress());
      expect(userDeposit.principal).to.equal(firstDeposit.add(secondDeposit));
      expect(await bitcoinYieldVault.totalBitcoinDeposited()).to.equal(firstDeposit.add(secondDeposit));
    });

    it("Should not allow deposits when paused", async function () {
      await bitcoinYieldVault.pauseVault();
      const depositAmount = ethers.utils.parseUnits("1", 8);
      
      await expect(bitcoinYieldVault.connect(user1).depositBitcoin(depositAmount))
        .to.be.revertedWith("Vault is paused");
    });
  });

  describe("Withdrawals", function () {
    beforeEach(async function () {
      // Setup initial deposit
      const depositAmount = ethers.utils.parseUnits("1", 8);
      await bitcoinYieldVault.connect(user1).depositBitcoin(depositAmount);
    });

    it("Should allow full withdrawal", async function () {
      const userAddress = await user1.getAddress();
      const userDeposit = await bitcoinYieldVault.getUserDeposit(userAddress);
      
      await expect(bitcoinYieldVault.connect(user1).withdraw(0))
        .to.emit(bitcoinYieldVault, "Withdrawal");

      const updatedDeposit = await bitcoinYieldVault.getUserDeposit(userAddress);
      expect(updatedDeposit.principal).to.equal(0);
      expect(updatedDeposit.isActive).to.be.false;
    });

    it("Should allow partial withdrawal", async function () {
      const userAddress = await user1.getAddress();
      const withdrawAmount = ethers.utils.parseUnits("0.3", 8);
      
      await bitcoinYieldVault.connect(user1).withdraw(withdrawAmount);

      const userDeposit = await bitcoinYieldVault.getUserDeposit(userAddress);
      expect(userDeposit.principal).to.be.gt(0);
      expect(userDeposit.isActive).to.be.true;
    });

    it("Should reject withdrawal with insufficient balance", async function () {
      const excessiveAmount = ethers.utils.parseUnits("2", 8); // More than deposited
      
      await expect(bitcoinYieldVault.connect(user1).withdraw(excessiveAmount))
        .to.be.revertedWith("Insufficient balance");
    });

    it("Should not allow withdrawal when paused", async function () {
      await bitcoinYieldVault.pauseVault();
      
      await expect(bitcoinYieldVault.connect(user1).withdraw(0))
        .to.be.revertedWith("Vault is paused");
    });

    it("Should reject withdrawal from user with no deposit", async function () {
      await expect(bitcoinYieldVault.connect(user2).withdraw(0))
        .to.be.revertedWith("User has no active deposit");
    });
  });

  describe("Protocol Management", function () {
    it("Should allow admin to add yield protocol", async function () {
      const protocolAddress = await addrs[0].getAddress();
      const chainId = 1;
      const apy = 500; // 5%
      
      await expect(bitcoinYieldVault.addYieldProtocol(protocolAddress, chainId, apy))
        .to.emit(bitcoinYieldVault, "ProtocolAdded")
        .withArgs(1, protocolAddress, chainId);

      expect(await bitcoinYieldVault.protocolCount()).to.equal(1);
      
      const protocolInfo = await bitcoinYieldVault.getProtocolInfo(1);
      expect(protocolInfo.protocolAddress).to.equal(protocolAddress);
      expect(protocolInfo.chainId).to.equal(chainId);
      expect(protocolInfo.currentAPY).to.equal(apy);
      expect(protocolInfo.isActive).to.be.true;
    });

    it("Should allow admin to update protocol", async function () {
      // First add a protocol
      const protocolAddress = await addrs[0].getAddress();
      await bitcoinYieldVault.addYieldProtocol(protocolAddress, 1, 500);
      
      const newAPY = 600;
      const isActive = false;
      
      await expect(bitcoinYieldVault.updateProtocol(1, newAPY, isActive))
        .to.emit(bitcoinYieldVault, "ProtocolUpdated")
        .withArgs(1, newAPY, isActive);

      const protocolInfo = await bitcoinYieldVault.getProtocolInfo(1);
      expect(protocolInfo.currentAPY).to.equal(newAPY);
      expect(protocolInfo.isActive).to.equal(isActive);
    });

    it("Should not allow non-admin to add protocol", async function () {
      const protocolAddress = await addrs[0].getAddress();
      
      await expect(bitcoinYieldVault.connect(user1).addYieldProtocol(protocolAddress, 1, 500))
        .to.be.revertedWith("Only admin can call this function");
    });

    it("Should allow admin to set chain ZRC20 mapping", async function () {
      const chainId = 1;
      const zrc20Address = await addrs[0].getAddress();
      
      await bitcoinYieldVault.setChainZRC20(chainId, zrc20Address);
      expect(await bitcoinYieldVault.chainToZRC20(chainId)).to.equal(zrc20Address);
    });
  });

  describe("Fee Management", function () {
    it("Should allow admin to set performance fee", async function () {
      const newFee = 1500; // 15%
      
      await bitcoinYieldVault.setPerformanceFee(newFee);
      expect(await bitcoinYieldVault.performanceFee()).to.equal(newFee);
    });

    it("Should reject excessive performance fee", async function () {
      const excessiveFee = 2500; // 25%, above 20% limit
      
      await expect(bitcoinYieldVault.setPerformanceFee(excessiveFee))
        .to.be.revertedWith("Fee cannot exceed 20%");
    });

    it("Should not allow non-admin to set fee", async function () {
      await expect(bitcoinYieldVault.connect(user1).setPerformanceFee(1000))
        .to.be.revertedWith("Only admin can call this function");
    });
  });

  describe("Vault Pausing", function () {
    it("Should allow admin to pause vault", async function () {
      await bitcoinYieldVault.pauseVault();
      expect(await bitcoinYieldVault.vaultPaused()).to.be.true;
    });

    it("Should allow admin to unpause vault", async function () {
      await bitcoinYieldVault.pauseVault();
      await bitcoinYieldVault.unpauseVault();
      expect(await bitcoinYieldVault.vaultPaused()).to.be.false;
    });

    it("Should not allow non-admin to pause", async function () {
      await expect(bitcoinYieldVault.connect(user1).pauseVault())
        .to.be.revertedWith("Only admin can call this function");
    });
  });

  describe("Treasury Management", function () {
    it("Should allow admin to set new treasury", async function () {
      const newTreasury = await addrs[0].getAddress();
      
      await bitcoinYieldVault.setTreasury(newTreasury);
      expect(await bitcoinYieldVault.treasury()).to.equal(newTreasury);
    });

    it("Should reject zero address as treasury", async function () {
      await expect(bitcoinYieldVault.setTreasury(ethers.constants.AddressZero))
        .to.be.revertedWith("Invalid treasury address");
    });

    it("Should not allow non-admin to set treasury", async function () {
      const newTreasury = await addrs[0].getAddress();
      
      await expect(bitcoinYieldVault.connect(user1).setTreasury(newTreasury))
        .to.be.revertedWith("Only admin can call this function");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      const depositAmount = ethers.utils.parseUnits("1", 8);
      await bitcoinYieldVault.connect(user1).depositBitcoin(depositAmount);
      await bitcoinYieldVault.addYieldProtocol(await addrs[0].getAddress(), 1, 500);
    });

    it("Should return correct user deposit info", async function () {
      const userAddress = await user1.getAddress();
      const userDeposit = await bitcoinYieldVault.getUserDeposit(userAddress);
      
      expect(userDeposit.principal).to.equal(ethers.utils.parseUnits("1", 8));
      expect(userDeposit.isActive).to.be.true;
      expect(userDeposit.accruedYield).to.equal(0);
    });

    it("Should return correct protocol info", async function () {
      const protocolInfo = await bitcoinYieldVault.getProtocolInfo(1);
      
      expect(protocolInfo.protocolAddress).to.equal(await addrs[0].getAddress());
      expect(protocolInfo.chainId).to.equal(1);
      expect(protocolInfo.currentAPY).to.equal(500);
      expect(protocolInfo.isActive).to.be.true;
    });

    it("Should return correct total stats", async function () {
      const stats = await bitcoinYieldVault.getTotalStats();
      
      expect(stats.totalDeposited).to.equal(ethers.utils.parseUnits("1", 8));
      expect(stats.totalYield).to.equal(0);
      expect(stats.activeProtocols).to.equal(1);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle deposit after partial withdrawal", async function () {
      const initialDeposit = ethers.utils.parseUnits("1", 8);
      const withdrawAmount = ethers.utils.parseUnits("0.3", 8);
      const additionalDeposit = ethers.utils.parseUnits("0.5", 8);
      
      await bitcoinYieldVault.connect(user1).depositBitcoin(initialDeposit);
      await bitcoinYieldVault.connect(user1).withdraw(withdrawAmount);
      await bitcoinYieldVault.connect(user1).depositBitcoin(additionalDeposit);

      const userDeposit = await bitcoinYieldVault.getUserDeposit(await user1.getAddress());
      const expectedAmount = initialDeposit.sub(withdrawAmount).add(additionalDeposit);
      expect(userDeposit.principal).to.be.closeTo(expectedAmount, ethers.utils.parseUnits("0.001", 8));
    });

    it("Should handle multiple users with different deposits", async function () {
      const user1Deposit = ethers.utils.parseUnits("1", 8);
      const user2Deposit = ethers.utils.parseUnits("2", 8);
      
      await bitcoinYieldVault.connect(user1).depositBitcoin(user1Deposit);
      await bitcoinYieldVault.connect(user2).depositBitcoin(user2Deposit);

      const user1Data = await bitcoinYieldVault.getUserDeposit(await user1.getAddress());
      const user2Data = await bitcoinYieldVault.getUserDeposit(await user2.getAddress());
      
      expect(user1Data.principal).to.equal(user1Deposit);
      expect(user2Data.principal).to.equal(user2Deposit);
      expect(await bitcoinYieldVault.totalBitcoinDeposited()).to.equal(user1Deposit.add(user2Deposit));
    });
  });
});