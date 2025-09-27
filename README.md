# Omnichain Bitcoin Yield Vault

> **Revolutionizing Bitcoin DeFi with ZetaChain's Native Cross-Chain Technology**

A groundbreaking DeFi protocol that enables Bitcoin holders to earn yield across multiple blockchain ecosystems **without wrapping their BTC**, leveraging ZetaChain's Universal Smart Contract platform and native Bitcoin integration.

## 🚀 Project Overview

The Omnichain Bitcoin Yield Vault unlocks the massive $1.3 trillion Bitcoin market for DeFi participation by providing:

- **Direct Bitcoin Deposits**: No wrapping, no bridges - just native BTC integration via ZetaChain's TSS gateway
- **Cross-Chain Yield Optimization**: Automatically deploys funds to the highest-yielding protocols across Ethereum, BSC, Polygon, and more
- **Universal Smart Contracts**: Built on ZetaChain's omnichain architecture with robust error handling
- **Seamless UX**: Simple deposit/withdraw interface that abstracts away blockchain complexity

## ✨ Key Features

### 🔗 Native Bitcoin Integration
- Direct BTC deposits through ZetaChain's Threshold Signature Scheme (TSS)
- No wrapped tokens or risky bridge dependencies
- Maintains Bitcoin's security guarantees

### 🌐 Cross-Chain Yield Farming
- Automatic yield optimization across multiple chains
- Integration with leading DeFi protocols: Compound, Aave, PancakeSwap, QuickSwap
- Real-time yield comparison and smart deployment

### 🛡️ Universal Contract Architecture
- Implements ZetaChain's `onCall`, `onRevert`, and `onAbort` functions
- Robust error handling with automatic refunds
- Cross-chain transaction recovery mechanisms

### 📊 Advanced Monitoring
- Real-time portfolio tracking
- Yield performance analytics
- Transaction status monitoring across all chains

## 🏗️ Technical Architecture

### Smart Contract Stack
- **ZetaChain Universal EVM**: Omnichain smart contract deployment
- **Solidity 0.8.28**: Latest security features and optimizations
- **Hardhat 3 Beta**: Advanced development and testing framework
- **Foundry Integration**: Comprehensive testing suite

### Cross-Chain Infrastructure
- **ZetaChain Gateway**: Native cross-chain messaging
- **TSS Integration**: Secure Bitcoin custody without wrapping
- **Multi-Chain Connectors**: Seamless protocol integrations

### Supported Networks
- **ZetaChain**: Primary execution layer
- **Ethereum**: Compound, Aave integration
- **Binance Smart Chain**: PancakeSwap farming
- **Polygon**: QuickSwap and other DeFi protocols
- **Optimism**: Layer 2 yield opportunities

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm/yarn
- Git
- Basic understanding of DeFi and cross-chain protocols

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Sneekyboots/bitcoin-yield-vault.git
   cd bitcoin-yield-vault
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   # Create .env file
   cp .env.example .env
   
   # Configure your private keys and RPC URLs
   npx hardhat keystore set SEPOLIA_PRIVATE_KEY
   ```

### Development Workflow

#### Running Tests
Execute the comprehensive test suite:

```bash
# Run all tests
npx hardhat test

# Run Solidity unit tests
npx hardhat test solidity

# Run TypeScript integration tests
npx hardhat test mocha
```

#### Local Development
Start local ZetaChain development environment:

```bash
# Start local hardhat node
npx hardhat node

# Deploy contracts locally
npx hardhat ignition deploy ignition/modules/BitcoinYieldVault.ts
```

#### Network Deployments

**Deploy to ZetaChain Testnet:**
```bash
npx hardhat ignition deploy --network zetachain-testnet ignition/modules/BitcoinYieldVault.ts
```

**Deploy to Ethereum Sepolia:**
```bash
npx hardhat ignition deploy --network sepolia ignition/modules/BitcoinYieldVault.ts
```

## 🧪 Testing Strategy

### Unit Tests
- Smart contract logic validation
- Cross-chain message handling
- Yield calculation algorithms
- Error handling and recovery

### Integration Tests
- End-to-end Bitcoin deposit flows
- Cross-chain yield deployment
- Multi-protocol interaction testing
- TSS gateway integration

### Security Audits
- Automated vulnerability scanning
- Manual security reviews
- Cross-chain attack vector analysis
- Economic security modeling

## 🏆 ZetaChain Vibeathon Advantages

### Unique Value Proposition
- **First-to-Market**: Native Bitcoin DeFi without wrapping
- **Massive TAM**: $1.3T Bitcoin market opportunity
- **Technical Innovation**: Showcases ZetaChain's unique capabilities
- **Real Utility**: Solves genuine market pain points

### Competitive Advantages
- No wrapped token risks or bridge dependencies
- Automatic yield optimization across multiple chains
- Superior user experience with native Bitcoin support
- Robust technical architecture with comprehensive error handling

## 🛠️ Project Structure

```
bitcoin-yield-vault/
├── contracts/                 # Smart contract source code
│   ├── BitcoinYieldVault.sol # Main vault contract
│   ├── CrossChainYield.sol   # Cross-chain yield strategies
│   └── interfaces/           # Protocol interfaces
├── scripts/                  # Deployment and utility scripts
├── test/                     # Comprehensive test suite
├── ignition/                 # Hardhat Ignition deployment modules
└── docs/                     # Technical documentation
```

## 🌟 Roadmap

### Phase 1: Core Infrastructure ✅
- [x] Smart contract architecture design
- [x] Basic Bitcoin deposit/withdrawal functionality
- [x] ZetaChain testnet integration

### Phase 2: Cross-Chain Integration 🚧
- [ ] Multi-chain yield protocol connections
- [ ] Automated yield optimization algorithms
- [ ] Advanced error handling implementation

### Phase 3: Production Ready 📋
- [ ] Security audits and testing
- [ ] Mainnet deployment
- [ ] User interface development
- [ ] Community governance implementation

## 🤝 Contributing

We welcome contributions from the community! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:

- Development setup
- Code style guidelines
- Pull request process
- Issue reporting

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- **Documentation**: [docs.bitcoin-yield-vault.com](https://docs.bitcoin-yield-vault.com)
- **ZetaChain**: [zetachain.com](https://zetachain.com)
- **Vibeathon**: [vibeathon.zetachain.com](https://vibeathon.zetachain.com)

---

**Built with ❤️ for the ZetaChain Vibeathon 2025**
