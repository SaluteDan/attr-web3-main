# ATTR Smart Contracts - Deployment Guide

## 📋 Quick Overview

This repository contains the smart contracts for the ATTR platform, ready for deployment to Base Mainnet.

- **Status:** ✅ Ready for Deployment
- **Tests:** 106/106 passing
- **Security:** All critical fixes implemented
- **Solidity Version:** 0.8.26
- **Network:** Base (Mainnet & Sepolia)

---

## 📚 Documentation Files

Start here based on your role:

### For Developers

1. **[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)** - Step-by-step deployment instructions
2. **[SECURITY_AUDIT.md](./SECURITY_AUDIT.md)** - Security findings and fixes
3. **[CRITICAL_FIXES.md](./CRITICAL_FIXES.md)** - Details of all security improvements

### For Project Managers

1. **[DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)** - Pre/during/post deployment checklist
2. **[DEPLOYMENT_SUMMARY.md](./DEPLOYMENT_SUMMARY.md)** - Overview and timeline
3. **[DEPLOYMENT_README.md](./DEPLOYMENT_README.md)** - This file

### For Security/Auditors

1. **[SECURITY_AUDIT.md](./SECURITY_AUDIT.md)** - Complete security audit
2. **[CRITICAL_FIXES.md](./CRITICAL_FIXES.md)** - Implementation details of fixes
3. Test files in `test/` directory

---

## 🚀 Quick Start (5 minutes)

### 1. Clone & Setup

```bash
git clone <repo>
cd backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Verify Setup

```bash
npx hardhat test
# Expected output: 106 passing
```

### 4. Check Deployment Costs

```bash
npx hardhat run scripts/check-balance.ts --network baseSepolia
```

---

## 📦 Smart Contracts

### ATTRToken.sol

**ERC20 Governance Token**

- Capped supply (1 Billion)
- Burnable
- Permit (gasless approvals)
- Votes (governance)
- Access Control
- Pausable

**Deployment:**

```bash
npx hardhat run scripts/deploy-token.ts --network baseSepolia
```

### ATTRDeployer.sol

**Factory for NFT Collections**

- Creates NFTCollection instances
- Manages royalty splitting
- Tracks deployed collections

**Deployment:**

```bash
npx hardhat run scripts/deploy-factory.ts --network baseSepolia
```

### GovernanceNFT.sol

**ERC721 with Voting**

- Voting capabilities
- Royalty support (ERC2981)
- Voucher-based minting
- Pausable

**Deployment:**

```bash
npx hardhat run scripts/deploy-governance.ts --network baseSepolia
```

### MembershipToken.sol

**Tiered Membership NFT**

- Tier-based pricing
- Immediate payment forwarding
- Reentrancy protection
- Pausable
- Max supply cap

**Deployment:**

```bash
npx hardhat run scripts/deployMembershipToken.ts --network baseSepolia
```

### NFTCollection.sol

**User-Created NFT Collections**

- Dynamic metadata
- Royalty support
- Voucher minting
- ERC20 permit support
- Pausable

### PaymentSplitter.sol

**Revenue Sharing**

- Splits ETH and ERC20 payments
- Pull payment model
- Proportional distribution

---

## 🔒 Security Summary

### Critical Issues Fixed ✅

- ✅ Reentrancy vulnerability in MembershipToken
- ✅ Funds not forwarded immediately
- ✅ Wrong payment source in NFTCollection
- ✅ Missing emergency pause mechanism
- ✅ No max supply cap
- ✅ Missing input validation

### Security Features Added ✅

- ✅ ReentrancyGuard on payment functions
- ✅ Pausable on all minting functions
- ✅ Input validation in constructors
- ✅ Max supply caps
- ✅ Immediate payment forwarding
- ✅ Access control on critical functions

**See [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) for full details**

---

## 🧪 Testing

### Run All Tests

```bash
npx hardhat test
```

### Run Specific Test Suite

```bash
npx hardhat test test/ATTRToken.test.ts
npx hardhat test test/MembershipToken.test.ts
npx hardhat test test/GovernanceNFT.test.ts
```

### Test Coverage

```bash
npx hardhat coverage
```

### Test Results

```
106 passing (2s)
```

---

## 📋 Deployment Checklist

### Before Deployment

- [ ] All tests passing (106/106)
- [ ] Environment variables configured
- [ ] Account has sufficient ETH for gas
- [ ] Private key is secure
- [ ] Addresses verified

### Testnet Deployment (Base Sepolia)

- [ ] Deploy all contracts
- [ ] Verify on BaseScan
- [ ] Run integration tests
- [ ] Test all functions
- [ ] Monitor for issues

### Mainnet Deployment (Base Mainnet)

- [ ] Testnet deployment verified
- [ ] Team approval obtained
- [ ] Deploy all contracts
- [ ] Verify on BaseScan
- [ ] Monitor contract health

**See [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) for complete checklist**

---

## 🌐 Network Configuration

### Base Sepolia (Testnet)

- Chain ID: 84532
- RPC: https://sepolia.base.org
- Explorer: https://sepolia.basescan.org

### Base Mainnet

- Chain ID: 8453
- RPC: https://mainnet.base.org
- Explorer: https://basescan.org

---

## 💰 Gas Estimates

### Testnet Deployment

- Total Gas: ~6,700,000
- Cost (1 gwei): ~0.0067 ETH
- Cost (10 gwei): ~0.067 ETH

### Mainnet Deployment

- Total Gas: ~6,700,000
- Cost (50 gwei): ~0.335 ETH (~$200 USD)
- Cost (100 gwei): ~0.67 ETH (~$400 USD)

_Actual costs depend on current Base network gas prices_

---

## 📝 Environment Variables

Create `.env` file with:

```bash
# Network RPC URLs
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_MAINNET_RPC_URL=https://mainnet.base.org

# Deployment Account
PRIVATE_KEY=your_private_key_here

# Verification API Keys
BASESCAN_API_KEY=your_api_key
BASE_MAINNET_API_KEY=your_api_key

# Deployment Addresses
PLATFORM_TREASURY_ADDRESS=0x...
PAYMENT_RECEIVER=0x...
ROYALTY_RECEIVER=0x...

# Contract Parameters
MEMBERSHIP_MAX_SUPPLY=10000
GOV_MAX_SUPPLY=5000
GOV_MAX_MINT=1
GOV_ROYALTY_BPS=500
```

**See [.env.example](./.env.example) for complete template**

---

## 🔧 Deployment Scripts

### Deploy Token

```bash
npx hardhat run scripts/deploy-token.ts --network baseSepolia
```

### Deploy Factory

```bash
npx hardhat run scripts/deploy-factory.ts --network baseSepolia
```

### Deploy Governance NFT

```bash
npx hardhat run scripts/deploy-governance.ts --network baseSepolia
```

### Deploy Membership Token

```bash
npx hardhat run scripts/deployMembershipToken.ts --network baseSepolia
```

### Check Balance

```bash
npx hardhat run scripts/check-balance.ts --network baseSepolia
```

---

## 🐛 Troubleshooting

### Insufficient Funds

```bash
# Check balance
npx hardhat run scripts/check-balance.ts --network baseSepolia
```

### Compilation Errors

```bash
# Clean and recompile
npx hardhat clean
npx hardhat compile
```

### Test Failures

```bash
# Run specific test
npx hardhat test test/ATTRToken.test.ts

# Run with verbose output
npx hardhat test --verbose
```

### Verification Issues

- Ensure constructor arguments match deployment
- Check contract source code matches bytecode
- Verify API key is valid
- Wait for block confirmation

---

## 📞 Support

### Documentation

- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - Detailed instructions
- [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) - Security findings
- [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) - Checklist
- [CRITICAL_FIXES.md](./CRITICAL_FIXES.md) - Security fixes

### External Resources

- [Hardhat Docs](https://hardhat.org/docs)
- [Base Docs](https://docs.base.org)
- [OpenZeppelin](https://docs.openzeppelin.com/contracts)
- [BaseScan](https://basescan.org)

---

## ⚠️ Important Security Notes

1. **Never commit private keys** to version control
2. **Use hardware wallet** for mainnet deployments
3. **Test on testnet first** before mainnet
4. **Verify all addresses** before deployment
5. **Keep backups** of deployment artifacts
6. **Monitor contracts** after deployment

---

## 📊 Project Status

| Component          | Status      | Details                       |
| ------------------ | ----------- | ----------------------------- |
| Smart Contracts    | ✅ Ready    | All security fixes applied    |
| Unit Tests         | ✅ Ready    | 106/106 passing               |
| Security Audit     | ✅ Complete | All critical issues fixed     |
| Deployment Scripts | ✅ Ready    | All scripts tested            |
| Documentation      | ✅ Complete | Comprehensive guides provided |
| Testnet Ready      | ✅ Ready    | Can deploy immediately        |
| Mainnet Ready      | ✅ Ready    | After testnet verification    |

---

## 📅 Timeline

### Week 1: Testnet

- Deploy all contracts
- Verify on BaseScan
- Run integration tests

### Week 2: Testing

- Conduct security testing
- Perform load testing
- Fix any issues

### Week 3: Mainnet

- Deploy to mainnet
- Verify contracts
- Monitor health

---

## 🎯 Next Steps

1. **Read Documentation**

   - Start with [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
   - Review [SECURITY_AUDIT.md](./SECURITY_AUDIT.md)

2. **Prepare Environment**

   - Copy `.env.example` to `.env`
   - Fill in all required variables

3. **Test Locally**

   - Run `npx hardhat test`
   - Verify all 106 tests pass

4. **Deploy to Testnet**

   - Follow [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
   - Verify on BaseScan

5. **Deploy to Mainnet**
   - After testnet approval
   - Follow [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md)

---

## 📄 License

[Your License Here]

---

**Version:** 1.0  
**Last Updated:** April 9, 2026  
**Status:** ✅ Ready for Deployment
