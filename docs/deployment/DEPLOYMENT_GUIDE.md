# Smart Contract Deployment Guide

**Network:** Base Mainnet (Chain ID: 8453)  
**Solidity Version:** 0.8.26  
**EVM Version:** Cancun

---

## Prerequisites

### Environment Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Create `.env` file with required variables:**

   ```bash
   # RPC URLs
   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
   BASE_MAINNET_RPC_URL=https://mainnet.base.org

   # Private Key (for deployment)
   PRIVATE_KEY=your_private_key_here

   # API Keys for verification
   BASESCAN_API_KEY=your_basescan_api_key
   BASE_MAINNET_API_KEY=your_basescan_api_key

   # Deployment Configuration
   PLATFORM_TREASURY_ADDRESS=0x...
   PAYMENT_RECEIVER=0x...
   GOVERNANCE_OWNER=0x...

   # Contract Parameters
   MEMBERSHIP_MAX_SUPPLY=10000
   GOV_MAX_SUPPLY=5000
   GOV_MAX_MINT=1
   GOV_ROYALTY_BPS=500
   ```

3. **Verify Hardhat configuration:**
   ```bash
   npx hardhat config
   ```

---

## Deployment Steps

### Step 1: Test on Base Sepolia Testnet

#### 1.1 Deploy ATTRToken

```bash
npx hardhat run scripts/deploy-token.ts --network baseSepolia
```

**Parameters:**

- Cap: 1,000,000,000 ATTR (1 Billion)
- Initial Supply: 100,000,000 ATTR (10%)
- Treasury: `PLATFORM_TREASURY_ADDRESS`

**Output:** Save the token address to `.env` as `ATTR_TOKEN_ADDRESS`

#### 1.2 Deploy ATTRDeployer (Factory)

```bash
npx hardhat run scripts/deploy-factory.ts --network baseSepolia
```

**Output:** Save the factory address to `.env` as `FACTORY_CONTRACT_ADDRESS`

#### 1.3 Deploy GovernanceNFT

```bash
npx hardhat run scripts/deploy-governance.ts --network baseSepolia
```

**Parameters:**

- Name: "Platform Membership"
- Symbol: "MBR"
- Max Supply: 5,000
- Max Mint Per Wallet: 1
- Royalty: 5% (500 bps)

**Output:** Save the address to `.env` as `GOVERNANCE_NFT_ADDRESS`

#### 1.4 Deploy MembershipToken

```bash
npx hardhat run scripts/deployMembershipToken.ts --network baseSepolia
```

**Parameters:**

- Name: "ATTR ID"
- Symbol: "ATTR#"
- Max Supply: 10,000
- Payment Receiver: `PAYMENT_RECEIVER`

**Output:** Save the address to `.env` as `MEMBERSHIP_TOKEN_ADDRESS`

### Step 2: Run Full Test Suite

```bash
npx hardhat test
```

Expected output: **106 passing**

### Step 3: Verify Contracts on BaseScan

#### Verify ATTRToken

```bash
npx hardhat verify --network baseSepolia <TOKEN_ADDRESS> \
  "1000000000000000000000000000" \
  "100000000000000000000000000" \
  "<TREASURY_ADDRESS>"
```

#### Verify ATTRDeployer

```bash
npx hardhat verify --network baseSepolia <FACTORY_ADDRESS> "<DEPLOYER_ADDRESS>"
```

#### Verify GovernanceNFT

```bash
npx hardhat verify --network baseSepolia <GOV_NFT_ADDRESS> \
  "Platform Membership" \
  "MBR" \
  "<DEPLOYER_ADDRESS>" \
  "<ROYALTY_RECEIVER>" \
  "500" \
  "ipfs://QmYourMetadataHash" \
  "5000" \
  "<PAYMENT_RECEIVER>" \
  "1"
```

#### Verify MembershipToken

```bash
npx hardhat verify --network baseSepolia <MEMBERSHIP_ADDRESS> \
  "ATTR ID" \
  "ATTR#" \
  "<DEPLOYER_ADDRESS>" \
  "<PAYMENT_RECEIVER>" \
  "10000"
```

### Step 4: Integration Testing

1. **Test token transfers:**

   ```bash
   # Use Hardhat console
   npx hardhat console --network baseSepolia

   > const token = await ethers.getContractAt("ATTRToken", "<TOKEN_ADDRESS>")
   > await token.transfer("<RECIPIENT>", ethers.parseEther("100"))
   ```

2. **Test NFT minting:**

   ```bash
   > const nft = await ethers.getContractAt("GovernanceNFT", "<GOV_NFT_ADDRESS>")
   > await nft.mintTo("<RECIPIENT>", "ipfs://QmTest")
   ```

3. **Test MembershipToken:**
   ```bash
   > const membership = await ethers.getContractAt("MembershipToken", "<MEMBERSHIP_ADDRESS>")
   > await membership.setTierPrice(1, ethers.parseEther("0.1"))
   > await membership.mintMembership(1, "ipfs://tier1", { value: ethers.parseEther("0.1") })
   ```

### Step 5: Deploy to Base Mainnet

Once testnet deployment is verified and tested:

```bash
# Deploy ATTRToken
npx hardhat run scripts/deploy-token.ts --network baseMainnet

# Deploy ATTRDeployer
npx hardhat run scripts/deploy-factory.ts --network baseMainnet

# Deploy GovernanceNFT
npx hardhat run scripts/deploy-governance.ts --network baseMainnet

# Deploy MembershipToken
npx hardhat run scripts/deployMembershipToken.ts --network baseMainnet
```

---

## Post-Deployment Checklist

### Security

- [ ] All contracts verified on BaseScan
- [ ] External security audit completed
- [ ] No critical issues found
- [ ] All 106 tests passing

### Configuration

- [ ] Owner set to multi-sig wallet
- [ ] Payment receivers configured correctly
- [ ] Royalty receivers set appropriately
- [ ] Max supplies configured

### Monitoring

- [ ] Set up event monitoring
- [ ] Configure alerts for critical functions
- [ ] Document all contract addresses
- [ ] Create incident response plan

### Documentation

- [ ] Update README with contract addresses
- [ ] Document all environment variables
- [ ] Create user guides for minting
- [ ] Document governance procedures

---

## Contract Addresses (Testnet)

| Contract        | Address | Status  |
| --------------- | ------- | ------- |
| ATTRToken       | `TBD`   | Pending |
| ATTRDeployer    | `TBD`   | Pending |
| GovernanceNFT   | `TBD`   | Pending |
| MembershipToken | `TBD`   | Pending |

---

## Contract Addresses (Mainnet)

| Contract        | Address | Status  |
| --------------- | ------- | ------- |
| ATTRToken       | `TBD`   | Pending |
| ATTRDeployer    | `TBD`   | Pending |
| GovernanceNFT   | `TBD`   | Pending |
| MembershipToken | `TBD`   | Pending |

---

## Troubleshooting

### Deployment Fails with "Insufficient Funds"

- Check account balance: `npx hardhat run scripts/check-balance.ts --network baseSepolia`
- Ensure account has enough ETH for gas

### Verification Fails

- Verify contract source code matches deployed bytecode
- Check constructor arguments format
- Ensure API key is valid

### Test Failures

- Run `npx hardhat clean` to clear cache
- Run `npx hardhat compile` to recompile
- Run `npx hardhat test` to verify all tests pass

### Network Issues

- Check RPC URL is correct
- Verify network is accessible
- Try alternative RPC provider

---

## Gas Estimation

### Testnet Deployment Costs (Approximate)

| Contract        | Gas        | Cost (at 1 gwei) |
| --------------- | ---------- | ---------------- |
| ATTRToken       | ~1,200,000 | ~0.0012 ETH      |
| ATTRDeployer    | ~800,000   | ~0.0008 ETH      |
| GovernanceNFT   | ~2,500,000 | ~0.0025 ETH      |
| MembershipToken | ~2,200,000 | ~0.0022 ETH      |
| **Total**       | ~6,700,000 | **~0.0067 ETH**  |

### Mainnet Deployment Costs (Approximate)

At current Base mainnet gas prices (varies):

- Estimated total: **$50 - $200 USD**

---

## Security Reminders

⚠️ **CRITICAL:**

1. **Never commit private keys to version control**
2. **Use hardware wallet for mainnet deployments**
3. **Test all functions on testnet first**
4. **Verify all contract addresses before use**
5. **Keep backup of deployment addresses**
6. **Monitor contracts for suspicious activity**

---

## Support & Resources

- **Hardhat Docs:** https://hardhat.org/docs
- **Base Network:** https://docs.base.org
- **OpenZeppelin:** https://docs.openzeppelin.com/contracts
- **BaseScan:** https://basescan.org

---

**Last Updated:** April 9, 2026  
**Version:** 1.0
