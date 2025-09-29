import { ethers } from "hardhat";
import { BigNumber } from "ethers";

/**
 * Utility functions for Bitcoin Yield Vault operations
 */

export class VaultUtils {
  static readonly SATOSHIS_PER_BTC = 100_000_000;
  static readonly BASIS_POINTS = 10_000;
  static readonly SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

  /**
   * Convert BTC to satoshis
   */
  static btcToSatoshis(btc: number): BigNumber {
    return ethers.utils.parseUnits(btc.toString(), 8);
  }

  /**
   * Convert satoshis to BTC
   */
  static satoshisToBtc(satoshis: BigNumber): number {
    return parseFloat(ethers.utils.formatUnits(satoshis, 8));
  }

  /**
   * Convert basis points to percentage
   */
  static basisPointsToPercent(basisPoints: number): number {
    return basisPoints / 100;
  }

  /**
   * Convert percentage to basis points
   */
  static percentToBasisPoints(percent: number): number {
    return Math.round(percent * 100);
  }

  /**
   * Calculate APY from rate per second
   */
  static calculateAPY(ratePerSecond: BigNumber): number {
    const rate = parseFloat(ethers.utils.formatEther(ratePerSecond));
    const apy = (Math.pow(1 + rate, this.SECONDS_PER_YEAR) - 1) * 100;
    return apy;
  }

  /**
   * Calculate compound interest
   */
  static calculateCompoundInterest(
    principal: BigNumber,
    rate: number, // APY in percentage
    timeInSeconds: number
  ): BigNumber {
    const annualRate = rate / 100;
    const timeInYears = timeInSeconds / this.SECONDS_PER_YEAR;
    const compoundAmount = parseFloat(ethers.utils.formatEther(principal)) * 
      Math.pow(1 + annualRate, timeInYears);
    return ethers.utils.parseEther(compoundAmount.toString());
  }

  /**
   * Format address for display
   */
  static formatAddress(address: string, chars: number = 6): string {
    if (address.length <= chars * 2 + 2) return address;
    return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
  }

  /**
   * Format token amount for display
   */
  static formatTokenAmount(
    amount: BigNumber,
    decimals: number = 18,
    precision: number = 4
  ): string {
    return parseFloat(ethers.utils.formatUnits(amount, decimals)).toFixed(precision);
  }

  /**
   * Get current timestamp
   */
  static getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Add days to timestamp
   */
  static addDays(timestamp: number, days: number): number {
    return timestamp + (days * 24 * 60 * 60);
  }

  /**
   * Calculate time elapsed in days
   */
  static getElapsedDays(startTimestamp: number, endTimestamp?: number): number {
    const end = endTimestamp || this.getCurrentTimestamp();
    return (end - startTimestamp) / (24 * 60 * 60);
  }

  /**
   * Validate Ethereum address
   */
  static isValidAddress(address: string): boolean {
    return ethers.utils.isAddress(address);
  }

  /**
   * Generate random bytes32
   */
  static generateRandomBytes32(): string {
    return ethers.utils.hexlify(ethers.utils.randomBytes(32));
  }

  /**
   * Sleep for specified milliseconds
   */
  static async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry function with exponential backoff
   */
  static async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries) throw error;
        const delay = baseDelay * Math.pow(2, i);
        console.log(`Retry ${i + 1}/${maxRetries} after ${delay}ms...`);
        await this.sleep(delay);
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Get gas price with buffer
   */
  static async getGasPriceWithBuffer(
    provider: ethers.providers.Provider,
    bufferPercent: number = 10
  ): Promise<BigNumber> {
    const gasPrice = await provider.getGasPrice();
    const buffer = gasPrice.mul(bufferPercent).div(100);
    return gasPrice.add(buffer);
  }

  /**
   * Estimate gas with buffer
   */
  static async estimateGasWithBuffer(
    contract: ethers.Contract,
    method: string,
    args: any[],
    bufferPercent: number = 20
  ): Promise<BigNumber> {
    const gasEstimate = await contract.estimateGas[method](...args);
    const buffer = gasEstimate.mul(bufferPercent).div(100);
    return gasEstimate.add(buffer);
  }

  /**
   * Wait for transaction confirmation
   */
  static async waitForConfirmation(
    tx: ethers.ContractTransaction,
    confirmations: number = 1
  ): Promise<ethers.ContractReceipt> {
    console.log(`Waiting for ${confirmations} confirmation(s) for tx: ${tx.hash}`);
    const receipt = await tx.wait(confirmations);
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    return receipt;
  }

  /**
   * Parse events from transaction receipt
   */
  static parseEvents(
    receipt: ethers.ContractReceipt,
    contract: ethers.Contract,
    eventName?: string
  ): ethers.utils.LogDescription[] {
    const events: ethers.utils.LogDescription[] = [];
    
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (!eventName || parsed.name === eventName) {
          events.push(parsed);
        }
      } catch (error) {
        // Ignore unparseable logs
      }
    }
    
    return events;
  }

  /**
   * Calculate slippage amount
   */
  static calculateSlippage(
    amount: BigNumber,
    slippagePercent: number
  ): { min: BigNumber; max: BigNumber } {
    const slippageBps = this.percentToBasisPoints(slippagePercent);
    const slippageAmount = amount.mul(slippageBps).div(this.BASIS_POINTS);
    
    return {
      min: amount.sub(slippageAmount),
      max: amount.add(slippageAmount)
    };
  }

  /**
   * Validate slippage parameters
   */
  static validateSlippage(slippagePercent: number): boolean {
    return slippagePercent >= 0 && slippagePercent <= 50; // Max 50% slippage
  }

  /**
   * Calculate proportional amounts
   */
  static calculateProportionalAmounts(
    totalAmount: BigNumber,
    ratio1: number,
    ratio2: number
  ): { amount1: BigNumber; amount2: BigNumber } {
    const total = ratio1 + ratio2;
    const amount1 = totalAmount.mul(Math.round(ratio1 * 1000)).div(total * 1000);
    const amount2 = totalAmount.sub(amount1);
    
    return { amount1, amount2 };
  }

  /**
   * Check if amount is within limits
   */
  static isWithinLimits(
    amount: BigNumber,
    minAmount: BigNumber,
    maxAmount: BigNumber
  ): boolean {
    return amount.gte(minAmount) && amount.lte(maxAmount);
  }

  /**
   * Generate operation ID
   */
  static generateOperationId(
    user: string,
    protocolId: number,
    amount: BigNumber,
    timestamp?: number
  ): string {
    const ts = timestamp || this.getCurrentTimestamp();
    const data = ethers.utils.defaultAbiCoder.encode(
      ['address', 'uint256', 'uint256', 'uint256'],
      [user, protocolId, amount, ts]
    );
    return ethers.utils.keccak256(data);
  }

  /**
   * Convert chain name to chain ID
   */
  static getChainId(chainName: string): number {
    const chainIds: { [key: string]: number } = {
      'ethereum': 1,
      'bsc': 56,
      'polygon': 137,
      'avalanche': 43114,
      'fantom': 250,
      'arbitrum': 42161,
      'optimism': 10,
      'zetachain': 7000
    };
    
    const chainId = chainIds[chainName.toLowerCase()];
    if (!chainId) {
      throw new Error(`Unknown chain: ${chainName}`);
    }
    
    return chainId;
  }

  /**
   * Get chain name from chain ID
   */
  static getChainName(chainId: number): string {
    const chainNames: { [key: number]: string } = {
      1: 'Ethereum',
      56: 'BSC',
      137: 'Polygon',
      43114: 'Avalanche',
      250: 'Fantom',
      42161: 'Arbitrum',
      10: 'Optimism',
      7000: 'ZetaChain'
    };
    
    return chainNames[chainId] || `Chain ${chainId}`;
  }

  /**
   * Encode cross-chain message
   */
  static encodeCrossChainMessage(
    operationId: string,
    operationType: number,
    amount: BigNumber,
    targetProtocol: string,
    additionalData?: string
  ): string {
    return ethers.utils.defaultAbiCoder.encode(
      ['bytes32', 'uint8', 'uint256', 'address', 'bytes'],
      [operationId, operationType, amount, targetProtocol, additionalData || '0x']
    );
  }

  /**
   * Decode cross-chain message
   */
  static decodeCrossChainMessage(message: string): {
    operationId: string;
    operationType: number;
    amount: BigNumber;
    targetProtocol: string;
    additionalData: string;
  } {
    const decoded = ethers.utils.defaultAbiCoder.decode(
      ['bytes32', 'uint8', 'uint256', 'address', 'bytes'],
      message
    );
    
    return {
      operationId: decoded[0],
      operationType: decoded[1],
      amount: decoded[2],
      targetProtocol: decoded[3],
      additionalData: decoded[4]
    };
  }

  /**
   * Get protocol type from adapter address (helper for testing)
   */
  static getProtocolTypeFromName(name: string): string {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('compound')) return 'compound';
    if (lowerName.includes('aave')) return 'aave';
    if (lowerName.includes('pancake')) return 'pancakeswap';
    if (lowerName.includes('quick')) return 'quickswap';
    return 'unknown';
  }

  /**
   * Calculate yield metrics
   */
  static calculateYieldMetrics(
    deposits: { amount: BigNumber; timestamp: number; apy: number }[]
  ): {
    totalPrincipal: BigNumber;
    totalYield: BigNumber;
    averageAPY: number;
    averageHoldingTime: number;
  } {
    if (deposits.length === 0) {
      return {
        totalPrincipal: BigNumber.from(0),
        totalYield: BigNumber.from(0),
        averageAPY: 0,
        averageHoldingTime: 0
      };
    }

    let totalPrincipal = BigNumber.from(0);
    let totalYield = BigNumber.from(0);
    let weightedAPY = 0;
    let totalHoldingTime = 0;
    const currentTime = this.getCurrentTimestamp();

    for (const deposit of deposits) {
      totalPrincipal = totalPrincipal.add(deposit.amount);
      
      const holdingTime = currentTime - deposit.timestamp;
      const yieldAmount = this.calculateCompoundInterest(
        deposit.amount,
        deposit.apy,
        holdingTime
      ).sub(deposit.amount);
      
      totalYield = totalYield.add(yieldAmount);
      weightedAPY += deposit.apy * parseFloat(ethers.utils.formatEther(deposit.amount));
      totalHoldingTime += holdingTime;
    }

    const totalPrincipalFloat = parseFloat(ethers.utils.formatEther(totalPrincipal));
    const averageAPY = totalPrincipalFloat > 0 ? weightedAPY / totalPrincipalFloat : 0;
    const averageHoldingTime = totalHoldingTime / deposits.length;

    return {
      totalPrincipal,
      totalYield,
      averageAPY,
      averageHoldingTime: averageHoldingTime / (24 * 60 * 60) // Convert to days
    };
  }
}

/**
 * Constants used throughout the application
 */
export const CONSTANTS = {
  ZERO_ADDRESS: ethers.constants.AddressZero,
  MAX_UINT256: ethers.constants.MaxUint256,
  SATOSHIS_PER_BTC: VaultUtils.SATOSHIS_PER_BTC,
  BASIS_POINTS: VaultUtils.BASIS_POINTS,
  SECONDS_PER_YEAR: VaultUtils.SECONDS_PER_YEAR,
  
  // Operation types
  OPERATION_TYPES: {
    DEPOSIT: 0,
    WITHDRAW: 1,
    HARVEST: 2,
    REBALANCE: 3,
    EMERGENCY: 4
  },
  
  // Transaction status
  TX_STATUS: {
    PENDING: 0,
    COMPLETED: 1,
    FAILED: 2,
    REVERTED: 3
  },
  
  // Default values
  DEFAULTS: {
    SLIPPAGE_PERCENT: 3,
    MAX_RETRIES: 3,
    CONFIRMATION_BLOCKS: 1,
    GAS_BUFFER_PERCENT: 20,
    PERFORMANCE_FEE_BPS: 1000 // 10%
  }
};

/**
 * Error handling utilities
 */
export class ErrorHandler {
  static handleContractError(error: any): string {
    if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
      return 'Transaction may fail due to insufficient gas or contract revert';
    }
    
    if (error.code === 'INSUFFICIENT_FUNDS') {
      return 'Insufficient funds to complete transaction';
    }
    
    if (error.code === 'NONCE_EXPIRED') {
      return 'Transaction nonce expired, please retry';
    }
    
    if (error.reason) {
      return error.reason;
    }
    
    if (error.message) {
      return error.message;
    }
    
    return 'Unknown contract error occurred';
  }
  
  static isRetryableError(error: any): boolean {
    const retryableCodes = [
      'NETWORK_ERROR',
      'TIMEOUT',
      'SERVER_ERROR',
      'NONCE_EXPIRED'
    ];
    
    return retryableCodes.includes(error.code) || 
           error.message?.includes('network') ||
           error.message?.includes('timeout');
  }
}

export default VaultUtils;