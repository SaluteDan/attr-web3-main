# Smart Contract Testing Strategy

**Version**: 1.0  
**Last Updated**: 2026-05-14  
**Applies To**: All Solidity contracts in the Attributes ecosystem

---

## 📋 Table of Contents

1. [Testing Philosophy](#testing-philosophy)
2. [Testing Pyramid](#testing-pyramid)
3. [Unit Testing](#unit-testing)
4. [Integration Testing](#integration-testing)
5. [Static Analysis](#static-analysis)
6. [Security Testing](#security-testing)
7. [Testnet Deployment](#testnet-deployment)
8. [CI/CD Integration](#cicd-integration)
9. [Coverage Requirements](#coverage-requirements)
10. [Testing Checklist](#testing-checklist)

---

## 🎯 Testing Philosophy

### Core Principles

1. **Test Behavior, Not Implementation**
   - Verify *what* the contract does, not *how* it does it
   - Tests should pass even if internal logic changes

2. **Fail Loud, Fail Early**
   - Use explicit assertions with descriptive messages
   - Never silently catch errors

3. **Assume Malice**
   - Test what happens when users try to exploit edge cases
   - Verify access control at every entry point

4. **Document Through Tests**
   - Each test describes expected behavior
   - Tests serve as executable specifications

### Definition of "Production Ready"

A contract is production ready when:
- [ ] All unit tests pass
- [ ] Static analysis shows zero high-severity issues
- [ ] Testnet deployment runs for 7+ days without issues
- [ ] Code coverage > 90%
- [ ] Integration tests with all dependent contracts pass
- [ ] Emergency procedures tested and documented

---

## 🔺 Testing Pyramid

```
                    ▲
                   / \
                  /   \
                 / Fuzz \
                / Testing  \      ← Millions of random inputs
               /────────────\
              /              \
             /   Integration   \   ← Contract interactions
            /     Testing       \    (ATTR + NFTCollection)
           /──────────────────────\
          /                        \
         /      Unit Testing         \  ← Individual functions
        /        (40+ tests)         \   (Happy + sad paths)
       /────────────────────────────────\
      /                                  \
     /        Static Analysis              ← Automated scanning
    /         (Slither, Solhint)           (Security + style)
   /───────────────────────────────────────\
```

**Distribution of Effort:**
- 70% Unit Tests (foundation)
- 20% Integration Tests (interactions)
- 10% Fuzz/Security (edge cases)

---

## 🧪 Unit Testing

### Framework: Hardhat + Ethers.js + Chai

**Standard test structure:**

```typescript
describe("ContractName", () => {
  // Setup
  beforeEach(async () => {
    // Deploy fresh contract instance
  });

  describe("FunctionName", () => {
    it("Should succeed with valid inputs", async () => {
      // Happy path test
    });

    it("Should revert with invalid inputs", async () => {
      // Sad path test
    });

    it("Should emit correct events", async () => {
      // Event verification
    });
  });
});
```

### Required Test Categories

#### 1. Deployment Tests
```typescript
describe("Deployment", () => {
  it("Should set correct name and symbol", async () => {});
  it("Should assign DEFAULT_ADMIN_ROLE to deployer", async () => {});
  it("Should mint initial supply to treasury", async () => {});
  it("Should revert if cap is zero", async () => {});
  it("Should revert if initial supply exceeds cap", async () => {});
  it("Should revert if treasury is zero address", async () => {});
});
```

#### 2. Access Control Tests
```typescript
describe("Access Control", () => {
  it("Should allow admin to grant roles", async () => {});
  it("Should prevent non-admin from granting roles", async () => {});
  it("Should allow minter to mint", async () => {});
  it("Should prevent non-minter from minting", async () => {});
  it("Should allow admin to revoke roles", async () => {});
  it("Should correctly check role membership", async () => {});
});
```

#### 3. State Transition Tests
```typescript
describe("State Changes", () => {
  it("Should update total supply on mint", async () => {});
  it("Should update balances on transfer", async () => {});
  it("Should decrease supply on burn", async () => {});
  it("Should maintain cap invariant", async () => {});
});
```

#### 4. Edge Case Tests
```typescript
describe("Edge Cases", () => {
  it("Should handle zero amount transfers", async () => {});
  it("Should handle max uint256 values", async () => {});
  it("Should handle empty address interactions", async () => {});
  it("Should handle repeated operations", async () => {});
});
```

### Testing Best Practices

**1. Use Fixtures for Setup**
```typescript
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

async function deployTokenFixture() {
  const [owner, addr1, addr2] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("ATTRToken");
  const token = await Token.deploy(cap, initialSupply, treasury.address);
  return { token, owner, addr1, addr2 };
}

// In test:
const { token, owner } = await loadFixture(deployTokenFixture);
```

**2. Test Event Emission**
```typescript
await expect(token.mint(to, amount))
  .to.emit(token, "Transfer")
  .withArgs(ethers.ZeroAddress, to, amount);
```

**3. Test Reverts with Specific Messages**
```typescript
await expect(token.connect(addr1).mint(to, amount))
  .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
  .withArgs(addr1.address, MINTER_ROLE);
```

**4. Use Time Helpers for Vesting**
```typescript
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

await time.increase(30 * 24 * 60 * 60); // +30 days
```

---

## 🔗 Integration Testing

### Testing Contract Interactions

**Example: ATTRToken + NFTCollection**

```typescript
describe("NFT Payment Flow", () => {
  it("Should allow NFT minting with ATTR", async () => {
    // 1. User buys ATTR from DEX (simulated)
    await attrToken.transfer(user.address, mintPrice);

    // 2. User approves NFTCollection
    await attrToken.connect(user).approve(nftCollection.address, mintPrice);

    // 3. NFT minting transfers ATTR to treasury
    await nftCollection.connect(user).redeem(voucher);

    // 4. Verify balances
    expect(await attrToken.balanceOf(user.address)).to.equal(0);
    expect(await attrToken.balanceOf(treasury.address))
      .to.equal(initialTreasury + mintPrice);
  });
});
```

### Fork Testing (Production State)

```typescript
// hardhat.config.ts
networks: {
  hardhat: {
    forking: {
      url: process.env.BASE_MAINNET_RPC_URL,
      blockNumber: 15000000, // Pin to specific block
    },
  },
}
```

**Benefits:**
- Test against real Uniswap pools
- Verify with actual token balances
- Simulate mainnet conditions

---

## 🔍 Static Analysis

### Tools Setup

#### 1. Solhint (Linting + Style)

```bash
npm install -g solhint
solhint --init  # Creates .solhint.json
```

**Configuration (`.solhint.json`):**
```json
{
  "extends": "solhint:recommended",
  "rules": {
    "no-global-import": "off",
    "func-visibility": ["warn", { "ignoreConstructors": true }],
    "gas-custom-errors": "off",
    "gas-strict-inequalities": "off"
  }
}
```

**Run:**
```bash
npx solhint contracts/**/*.sol
```

#### 2. Slither (Security Analysis)

```bash
pip install slither-analyzer
```

**Run:**
```bash
slither contracts/ATTRToken.sol
```

**Key Checks:**
- Reentrancy vulnerabilities
- Unchecked external calls
- tx.origin usage
- Shadowing variables
- Unused return values

**Severity Levels:**
- 🔴 High: Fix before mainnet
- 🟡 Medium: Review and document
- 🟢 Low: Informational, fix if time permits

#### 3. Mythril (Symbolic Execution)

```bash
pip install mythril
myth analyze contracts/ATTRToken.sol
```

**Deep analysis for:**
- Integer overflow/underflow
- Unreachable code
- State manipulation

---

## 🛡️ Security Testing

### 1. Access Control Fuzzing

```typescript
for (let i = 0; i < 100; i++) {
  const randomAddr = ethers.Wallet.createRandom().address;
  await expect(token.connect(randomAddr).mint(to, amount))
    .to.be.reverted;
}
```

### 2. Economic Attack Simulation

```typescript
it("Should resist flash loan attacks", async () => {
  // Simulate price manipulation
  // Verify invariants hold
});

it("Should handle sandwich attacks", async () => {
  // Test slippage protection
});
```

### 3. Reentrancy Guards

```typescript
it("Should prevent reentrancy on mint", async () => {
  const attacker = await deployReentrancyAttacker();
  await expect(attacker.attack()).to.be.reverted;
});
```

---

## 🌐 Testnet Deployment

### Pre-Mainnet Checklist

**Base Sepolia Testing:**

```bash
# 1. Deploy fresh contract
npx hardhat run scripts/deploy-token.ts --network baseSepolia

# 2. Verify on BaseScan
npx hardhat verify --network baseSepolia <address> <args>

# 3. Run full lifecycle tests
```

**Required Tests:**
- [ ] Contract deployment and verification
- [ ] Role transfer to multisig
- [ ] Minting up to cap limit
- [ ] Burning and supply reduction
- [ ] ERC20Permit with real signatures
- [ ] Voting power delegation
- [ ] Airdrop distribution (bulk transfer)
- [ ] DEX liquidity addition (Uniswap V3)
- [ ] NFT payment integration
- [ ] Emergency pause/unpause
- [ ] 7-day stability monitoring

**Monitoring:**
```bash
# Watch for unexpected transactions
npx hardhat console --network baseSepolia
> await token.totalSupply()
> await token.hasRole(MINTER_ROLE, addr)
```

---

## 🔄 CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Smart Contract Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npx hardhat test

      - name: Run static analysis
        run: |
          npm install -g solhint
          npx solhint contracts/**/*.sol

      - name: Check code coverage
        run: npx hardhat coverage

      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
```

### Pre-Commit Hooks

```json
// package.json
"husky": {
  "hooks": {
    "pre-commit": "npm run lint && npm test"
  }
}
```

---

## 📊 Coverage Requirements

### Minimum Thresholds

| Category | Minimum | Target |
|----------|---------|--------|
| Statements | 90% | 95% |
| Branches | 85% | 90% |
| Functions | 90% | 95% |
| Lines | 90% | 95% |

### Running Coverage

```bash
npx hardhat coverage
```

**Output:**
```
--------------------------|----------|----------|----------|----------|
File                      |  % Stmts | % Branch |  % Funcs |  % Lines |
--------------------------|----------|----------|----------|----------|
 contracts/ATTRToken.sol  |    95.45 |    88.89 |      100 |    95.45 |
--------------------------|----------|----------|----------|----------|
```

### Coverage Gaps to Avoid

- ❌ Untested revert paths
- ❌ Missing event emission tests
- ❌ Unchecked admin functions
- ❌ No integration tests

---

## ✅ Testing Checklist

### For Every New Contract

**Unit Tests:**
- [ ] Deployment scenarios (valid + invalid)
- [ ] All public/external functions tested
- [ ] Access control on restricted functions
- [ ] Event emission verified
- [ ] State changes validated
- [ ] Edge cases (zero, max values)
- [ ] Error conditions with specific messages

**Integration:**
- [ ] Interacts correctly with existing contracts
- [ ] Token transfers work (if applicable)
- [ ] Role permissions cascade properly
- [ ] Emergency procedures tested

**Security:**
- [ ] Slither analysis (0 high severity)
- [ ] Solhint (0 errors)
- [ ] Access control fuzzing
- [ ] Reentrancy tests (if external calls)
- [ ] Economic attack simulation

**Testnet:**
- [ ] Deployed to Sepolia
- [ ] Verified on BaseScan
- [ ] All functions called at least once
- [ ] 7-day monitoring period
- [ ] Emergency procedures tested live

**Documentation:**
- [ ] Test file documents expected behavior
- [ ] Complex tests have inline comments
- [ ] Gas costs documented (if relevant)
- [ ] Known limitations listed

---

## 🛠️ Testing Tools Reference

| Tool | Purpose | Install | Run |
|------|---------|---------|-----|
| **Hardhat** | Test framework | `npm i` | `npx hardhat test` |
| **Solhint** | Linting | `npm i -g solhint` | `npx solhint contracts/*.sol` |
| **Slither** | Security | `pip install slither-analyzer` | `slither contracts/*.sol` |
| **Mythril** | Deep analysis | `pip install mythril` | `myth analyze contracts/*.sol` |
| **Echidna** | Fuzzing | Docker | `echidna-test Contract.sol` |
| **Coverage** | Metrics | Built-in | `npx hardhat coverage` |

---

## 📚 Example: Complete Test File

See: `test/ATTRToken.test.ts` for production-ready example covering:
- 40+ test cases
- All major functionality
- Edge cases and error conditions
- Integration patterns
- Gas optimization verification

---

## 🎯 Summary

**Before Mainnet:**
1. ✅ 40+ unit tests passing
2. ✅ Static analysis clean (Slither, Solhint)
3. ✅ >90% code coverage
4. ✅ Sepolia testnet deployment successful
5. ✅ 7-day stability monitoring complete
6. ✅ Emergency procedures tested

**Remember:** Tests are insurance. The more thorough now, the fewer exploits later.

---

**Document Status**: Active  
**Review Schedule**: Monthly  
**Owner**: Smart Contract Team
