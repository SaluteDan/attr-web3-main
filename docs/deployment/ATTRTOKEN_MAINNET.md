# ATTRToken Mainnet Deployment Guide

**Contract**: `ATTRToken.sol`  
**Network**: Base Mainnet (Chain ID: 8453)  
**Last Updated**: 2026-04-03

---

## 📋 Table of Contents

1. [Contract Overview](#contract-overview)
2. [Pre-Deployment Checklist](#pre-deployment-checklist)
3. [Testing Requirements](#testing-requirements)
4. [Deployment Workflow](#deployment-workflow)
5. [Post-Deployment Security](#post-deployment-security)
6. [DEX Liquidity Strategy](#dex-liquidity-strategy)
7. [LP Token Locking Explained](#lp-token-locking-explained)
8. [Airdrop Strategy](#airdrop-strategy)
9. [Tokenomics & Allocation](#tokenomics--allocation)
10. [The Liquidity-Airdrop Paradox](#the-liquidity-airdrop-paradox--solutions)
11. [Troubleshooting](#troubleshooting)
12. [Risk Assessment](#risk-assessment)
13. [Executive Summary](#executive-summary)

---

## Contract Overview

### Token Specifications

- **Name**: Attribute Point
- **Symbol**: ATTR
- **Decimals**: 18
- **Max Supply (Cap)**: 1,000,000,000 ATTR (1 Billion)
- **Initial Mint**: 100,000,000 ATTR (100 Million, 10% of cap)
- **Initial Recipient**: Treasury wallet

### Features

- ✅ **ERC20** - Standard fungible token
- ✅ **ERC20Burnable** - Token holders can burn their tokens
- ✅ **ERC20Capped** - Immutable 1B supply cap
- ✅ **ERC20Permit (EIP-2612)** - Gasless approvals via signatures
- ✅ **ERC20Votes** - On-chain governance with delegation
- ✅ **AccessControl** - Role-based permissions (MINTER_ROLE, DEFAULT_ADMIN_ROLE)

### Inheritance Chain

```
ATTRToken
├── ERC20
├── ERC20Burnable
├── ERC20Capped
├── ERC20Permit
├── ERC20Votes
└── AccessControl
```

---

## 🔴 Pre-Deployment Checklist

### Phase 0: Security & Keys (BLOCKERS)

- [ ] **Generate fresh mainnet deployer wallet**

  - Do NOT reuse the key in `.env` or `.env.production`
  - Treat existing keys as testnet-only and potentially compromised
  - Store new key securely (hardware wallet or encrypted vault)

- [ ] **Create Gnosis Safe multisig on Base Mainnet**

  - Recommended: 2-of-3 or 3-of-5 configuration
  - This will receive `DEFAULT_ADMIN_ROLE` after deployment
  - Document all signer addresses

- [ ] **Separate treasury from deployer**

  - Treasury should be Gnosis Safe or hardware wallet
  - Treasury receives the 100M initial mint
  - Treasury ≠ Deployer ≠ Relayer (different addresses)

- [ ] **Verify `.gitignore` includes sensitive files**

  ```bash
  # Check if .env was ever committed
  git log --all --full-history -- .env .env.production
  ```

  - If output shows commits, those keys are compromised

- [ ] **Obtain Base Mainnet API key**
  - Get from: https://basescan.org/myapikey
  - Add to `.env` as `BASE_MAINNET_API_KEY`

### Phase 1: Configuration

- [ ] **Confirm final tokenomics (IMMUTABLE after deploy)**

  - Cap: 1,000,000,000 ATTR ✓
  - Initial mint: 100,000,000 ATTR (10%) ✓
  - Decimals: 18 ✓

- [ ] **Update `.env` for mainnet**

  ```env
  # Treasury (receives initial 100M)
  PLATFORM_TREASURY_ADDRESS=<gnosis_safe_or_hardware_wallet>

  # Deployer (fresh wallet, will be revoked after deployment)
  PRIVATE_KEY=<new_mainnet_deployer_private_key>

  # Backend relayer (will receive MINTER_ROLE)
  RELAYER_ADDRESS=<backend_hot_wallet>

  # Gnosis Safe (will receive DEFAULT_ADMIN_ROLE)
  GNOSIS_SAFE_ADDRESS=<multisig_address>

  # RPC (use private endpoint for reliability)
  BASE_MAINNET_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<your_key>

  # Verification
  BASE_MAINNET_API_KEY=<basescan_api_key>
  ```

- [ ] **Fix misleading env var names** (optional but recommended)

  - Rename `TOKEN_URI` → `ATTR_TOKEN_ADDRESS`
  - Document what `TOKEN_DECIMALS=1000000` represents (not standard 18)

- [ ] **Fund deployer wallet**
  - Minimum: ~0.05 ETH for deployment gas
  - Check current Base gas prices

### Phase 2: Testing (REQUIRED before mainnet)

- [ ] **Run full test suite**

  ```bash
  npx hardhat test test/ATTRToken.test.ts
  ```

  - All 40+ tests must pass
  - Tests cover: cap, roles, burn, permit, votes, delegation

- [ ] **Deploy to Base Sepolia with production config**

  ```bash
  npx hardhat run scripts/deploy-token.ts --network baseSepolia
  ```

  - Use same tokenomics (1B cap, 100M initial)
  - Use fresh testnet wallet (not the mainnet one)

- [ ] **End-to-end testnet verification**
  - [ ] Mint additional tokens (verify cap enforcement)
  - [ ] Burn tokens (verify supply decreases)
  - [ ] Test ERC20Permit signature flow
  - [ ] Delegate voting power (verify `getVotes` works)
  - [ ] Transfer roles to test multisig
  - [ ] Test NFT minting with ATTR payment (via `NFTCollection.redeem()`)

---

## 🧪 Testing Requirements

### Minimum Test Coverage

| Category             | Tests   | Status         |
| -------------------- | ------- | -------------- |
| Deployment           | 6 tests | ✅ Implemented |
| Cap Enforcement      | 3 tests | ✅ Implemented |
| Role-Based Minting   | 5 tests | ✅ Implemented |
| Burning              | 4 tests | ✅ Implemented |
| ERC20Permit          | 4 tests | ✅ Implemented |
| ERC20Votes           | 7 tests | ✅ Implemented |
| Admin Roles          | 6 tests | ✅ Implemented |
| Treasury Integration | 2 tests | ✅ Implemented |

### Critical Test Scenarios

1. **Cap Enforcement**

   - Minting beyond cap reverts with `ERC20ExceededCap`
   - Minting exactly to cap succeeds
   - Initial supply > cap reverts at construction

2. **Role Security**

   - Non-minter cannot mint
   - Role transfer works correctly
   - Revoked roles cannot perform actions

3. **Permit (Gasless Approvals)**

   - Valid signature grants approval
   - Expired signature reverts
   - Nonce increments after use

4. **Governance (Votes)**
   - Undelegated tokens have zero voting power
   - Self-delegation activates voting power
   - Checkpoints track historical votes

---

## 🚀 Deployment Workflow

### Step 1: Deploy Contract

```bash
npx hardhat run scripts/deploy-token.ts --network baseMainnet
```

**Expected Output:**

```
Deploying ATTRToken ($ATTR)...
Deploying with account: 0x...
Treasury: 0x...
Max Cap: 1,000,000,000 ATTR
Initial Mint: 100,000,000 ATTR

✅ ATTRToken deployed to: 0x...

=== Deployment Info ===
ATTR_TOKEN_ADDRESS=0x...

⚠️  Add to .env:
ATTR_TOKEN_ADDRESS=0x...

Verify on BaseScan:
npx hardhat verify --network baseMainnet 0x... "1000000000000000000000000000" "100000000000000000000000000" "0x..."
```

**Action Items:**

- [ ] Copy deployed address
- [ ] Add `ATTR_TOKEN_ADDRESS` to `.env`
- [ ] Save deployment transaction hash

### Step 2: Verify on BaseScan

```bash
npx hardhat verify --network baseMainnet <TOKEN_ADDRESS> "<cap>" "<initialSupply>" "<treasury>"
```

**Verification Checklist:**

- [ ] Contract verified on BaseScan
- [ ] Source code matches
- [ ] Constructor args decoded correctly
- [ ] Contract is readable on basescan.org

### Step 3: Transfer Roles (CRITICAL - Do Immediately)

```bash
npx hardhat run scripts/transfer-token-roles.ts --network baseMainnet
```

**What This Does:**

1. Grants `DEFAULT_ADMIN_ROLE` to Gnosis Safe
2. Grants `MINTER_ROLE` to backend relayer
3. Revokes `DEFAULT_ADMIN_ROLE` from deployer
4. Revokes `MINTER_ROLE` from deployer

**Expected Output:**

```
🔐 ATTRToken Role Transfer Script

Executing from deployer: 0x...
Token Address: 0x...
Gnosis Safe (new admin): 0x...
Relayer (new minter): 0x...

✅ Deployer verified as current admin

Step 1/4: Granting DEFAULT_ADMIN_ROLE to Gnosis Safe...
✅ Admin role granted to Safe. Tx: 0x...

Step 2/4: Granting MINTER_ROLE to Relayer...
✅ Minter role granted to Relayer. Tx: 0x...

Step 3/4: Revoking DEFAULT_ADMIN_ROLE from Deployer...
✅ Admin role revoked from Deployer. Tx: 0x...

Step 4/4: Revoking MINTER_ROLE from Deployer...
✅ Minter role revoked from Deployer. Tx: 0x...

=== Final Role Verification ===
Gnosis Safe has DEFAULT_ADMIN_ROLE: ✅
Relayer has MINTER_ROLE: ✅
Deployer has DEFAULT_ADMIN_ROLE: ❌ (good)
Deployer has MINTER_ROLE: ❌ (good)

🎉 Role transfer completed successfully!

⚠️  IMPORTANT: The deployer wallet no longer has any control over the token.
All future admin operations must be executed via the Gnosis Safe.
```

**Verification:**

- [ ] All 4 transactions confirmed
- [ ] Deployer has NO roles
- [ ] Safe has admin role
- [ ] Relayer has minter role

### Step 4: Activate Treasury Voting Power

**⚠️ Run this from the treasury wallet (not deployer)**

```bash
# Option A: If treasury is EOA with private key
PRIVATE_KEY=<treasury_key> npx hardhat run scripts/delegate-treasury-votes.ts --network baseMainnet

# Option B: If treasury is Gnosis Safe
# Use Safe UI to call: token.delegate(treasuryAddress)
```

**Expected Output:**

```
🗳️  Treasury Voting Power Delegation Script

Treasury Address: 0x...
Token Address: 0x...

=== Current State ===
Treasury Balance: 100000000.0 ATTR
Current Delegate: 0x0000000000000000000000000000000000000000
Current Voting Power: 0.0 ATTR

🔄 Delegating voting power to self...
Transaction submitted: 0x...
✅ Transaction confirmed

=== Final State ===
New Delegate: 0x... (treasury)
New Voting Power: 100000000.0 ATTR

🎉 Treasury voting power successfully activated!
```

**Why This Matters:**

- Without delegation, the 100M initial supply has ZERO voting weight
- Governance systems (Snapshot, Tally) require `getVotes()` > 0
- Self-delegation activates voting power without transferring control

---

## 🔐 Post-Deployment Security

### Immediate Actions (Within 24 Hours)

- [ ] **Verify deployer wallet is empty of roles**

  ```solidity
  // On BaseScan, check:
  token.hasRole(DEFAULT_ADMIN_ROLE, deployerAddress) // should be false
  token.hasRole(MINTER_ROLE, deployerAddress) // should be false
  ```

- [ ] **Test multisig control**

  - Create a test transaction in Gnosis Safe
  - Verify all signers can approve
  - Execute a non-critical action (e.g., `token.name()` call)

- [ ] **Document all addresses**

  ```
  Token Contract: 0x...
  Gnosis Safe (Admin): 0x...
  Relayer (Minter): 0x...
  Treasury: 0x...
  Deployer (REVOKED): 0x...
  ```

- [ ] **Set up monitoring**
  - Watch `RoleGranted` events
  - Watch `RoleRevoked` events
  - Watch large `Transfer` events (> 1M ATTR)
  - Alert on any `mint()` calls

### Ongoing Security

- [ ] **Rotate relayer key periodically** (every 6-12 months)
- [ ] **Review multisig signers** (add/remove as team changes)
- [ ] **Monitor total supply** (should never exceed 1B)
- [ ] **Track minting activity** (who, when, how much)

### Emergency Procedures

**If Relayer Key is Compromised:**

1. Immediately revoke `MINTER_ROLE` from compromised address (via Safe)
2. Grant `MINTER_ROLE` to new relayer address
3. Update backend `.env` with new relayer key
4. Investigate: check all mints from compromised key

**If Multisig Signer Key is Compromised:**

1. Remove compromised signer from Safe (requires other signers)
2. Add new signer
3. Consider increasing signature threshold temporarily

**If Token Has Critical Bug:**

- ⚠️ **No Pausable functionality** - cannot halt transfers
- Mitigation: Revoke `MINTER_ROLE` to prevent new supply
- Communicate with exchanges/holders
- Consider deploying v2 token with migration path

---

## 🔧 Troubleshooting

### Deployment Issues

**Error: "Insufficient funds"**

- Solution: Fund deployer wallet with more ETH
- Check gas price: https://basescan.org/gastracker

**Error: "Treasury cannot be zero address"**

- Solution: Verify `PLATFORM_TREASURY_ADDRESS` is set in `.env`

**Error: "ERC20ExceededCap"**

- Solution: Initial supply > cap. Reduce `INITIAL_MINT` or increase `CAP_AMOUNT`

### Verification Issues

**Error: "Invalid API Key"**

- Solution: Get fresh key from basescan.org/myapikey
- Ensure `BASE_MAINNET_API_KEY` is in `.env`

**Error: "Already verified"**

- Solution: Contract already verified, skip this step

**Error: "Constructor arguments mismatch"**

- Solution: Ensure arguments match deployment exactly (including quotes)

### Role Transfer Issues

**Error: "Deployer does not have DEFAULT_ADMIN_ROLE"**

- Solution: Roles already transferred, or wrong deployer wallet
- Check: `token.hasRole(DEFAULT_ADMIN_ROLE, deployerAddress)`

**Error: "Transaction reverted"**

- Solution: Check gas limit, ensure deployer has ETH for gas

### Voting Power Issues

**Treasury has zero votes after delegation**

- Check: `token.delegates(treasuryAddress)` should equal `treasuryAddress`
- Check: `token.balanceOf(treasuryAddress)` should equal `100000000e18`
- Solution: Re-run delegation script from correct wallet

---

## ⚠️ Risk Assessment

### Critical Risks (🔴 High Priority)

| Risk                                | Severity    | Mitigation                       | Status      |
| ----------------------------------- | ----------- | -------------------------------- | ----------- |
| Deployer key reuse from testnet     | 🔴 Critical | Rotate wallet before mainnet     | ⏳ Pending  |
| Single point of failure (EOA admin) | 🔴 Critical | Transfer to multisig immediately | ✅ Scripted |
| Treasury voting power inactive      | 🟡 Medium   | Run delegation script            | ✅ Scripted |

### Medium Risks (🟡 Monitor)

| Risk                      | Severity  | Mitigation                                         | Status   |
| ------------------------- | --------- | -------------------------------------------------- | -------- |
| No formal audit           | 🟡 Medium | OZ base contracts audited; custom logic minimal    | Accepted |
| No Pausable mechanism     | 🟡 Medium | Design choice; can revoke MINTER_ROLE in emergency | Accepted |
| Relayer key in hot wallet | 🟡 Medium | Rotate periodically; monitor minting               | Accepted |

### Low Risks (🟢 Acceptable)

| Risk                      | Severity | Mitigation         | Status   |
| ------------------------- | -------- | ------------------ | -------- |
| Misleading env var names  | 🟢 Low   | Rename for clarity | Optional |
| No on-chain governance UI | 🟢 Low   | Use Snapshot/Tally | Planned  |

---

## 📚 Additional Resources

### Contract Addresses (To Be Filled After Deployment)

```
Network: Base Mainnet (8453)

ATTRToken: 0x...
Gnosis Safe: 0x...
Treasury: 0x...
Relayer: 0x...

Deployment Tx: 0x...
Deployment Block: ...
Deployment Date: ...
```

### Related Contracts

- `ATTRDeployer` (Factory): 0x... (already deployed)
- `NFTCollection` (Template): Uses ATTR for payments
- `GovernanceNFT`: Uses ERC721Votes for DAO

### External Links

- BaseScan: https://basescan.org/address/0x...
- OpenZeppelin Docs: https://docs.openzeppelin.com/contracts/5.x/
- Gnosis Safe: https://app.safe.global/
- Snapshot (Governance): https://snapshot.org/

---

## 💭 DEX Liquidity Strategy

### Pool Pairing: ATTR vs ETH/WETH

**Short answer: YES—ATTR/WETH is the best choice for Base.**

#### Why ATTR/WETH Works on Base:

| Factor               | ATTR/WETH                   | ATTR/USDC                 | Notes                      |
| -------------------- | --------------------------- | ------------------------- | -------------------------- |
| **Universal access** | ✅ Everyone has ETH for gas | ❌ Need USDC specifically | ETH is Base's native token |
| **Deep liquidity**   | ✅ Most liquid on Base      | ✅ Liquid but smaller     | ETH pools dominate L2s     |
| **Price discovery**  | ✅ Easy USD calculation     | ✅ Direct USD price       | Both work via oracles      |
| **Uniswap V3**       | ✅ Native support           | ✅ Native support         | WETH is standard           |

**Important:** On Base, Uniswap V3 uses **WETH** (Wrapped ETH), not raw ETH. When users trade, their ETH is auto-wrapped.

#### Alternative: ATTR/USDC

Consider adding this in **Phase 2** (Month 2-3):

- Captures stablecoin-focused traders
- Easier USD-denominated mental model
- Less volatility for LPs

**Recommended approach:**

```
Phase 1 (Launch):
└── ATTR/WETH (Uniswap V3)
    └── $100K liquidity (15M ATTR + 15 ETH worth)

Phase 2 (Month 2-3):
└── ATTR/USDC (Aerodrome or BaseSwap)
    └── $50K liquidity (7.5M ATTR + 50K USDC)
```

---

## 🔐 LP Token Locking Explained

### What Gets Locked vs. What Stays Free

**Common misconception:** "Locking liquidity freezes trading"

**Reality:** Locking locks **YOUR WITHDRAWAL RIGHTS**, not the pool.

```
When you add liquidity to Uniswap V3:

┌──────────────────────────────┐     ┌──────────────────────────────┐
│        THE POOL              │     │      YOUR LP NFT             │
│  ┌─────────┐ ┌─────────┐    │     │  (Proof of ownership)        │
│  │  WETH   │ │  ATTR   │    │     │                              │
│  │  $50K   │ │  $50K   │    │     │  ┌────────┐   ┌────────┐     │
│  └─────────┘ └─────────┘    │     │  │ 50%    │   │ 50%    │     │
│                              │     │  │ LOCKED │   │ FREE   │     │
│  ← Trading ALWAYS works →   │     │  │2 years │   │Anytime │     │
│     (24/7, no restrictions)  │     │  └────────┘   └────────┘     │
└──────────────────────────────┘     └──────────────────────────────┘

Pool Status:        FULLY TRADEABLE ✅
Your Withdrawal:    50% locked, 50% free
Your Fee Earnings:  100% (even on locked portion)
```

### Why Lock 50%?

| Lock %  | Trust Signal          | Flexibility                 |
| ------- | --------------------- | --------------------------- |
| 100%    | Maximum               | Zero ability to adapt       |
| **50%** | **Strong commitment** | **Can rebalance if needed** |
| 25%     | Weak                  | Too much flexibility        |
| 0%      | "Might rug"           | Zero trust from community   |

**50% is the industry sweet spot** for new projects.

### Locking Tools

| Platform         | URL          | Cost      | Features                     |
| ---------------- | ------------ | --------- | ---------------------------- |
| **UncX**         | uncx.network | ~0.02 ETH | Simple, proven, public proof |
| **Team Finance** | team.finance | ~0.03 ETH | Extra features, audits       |

### Locking Steps

1. Add liquidity to Uniswap V3 → Get LP NFT
2. Go to uncx.network
3. Connect wallet, select LP NFT
4. Choose 50% of position
5. Set duration: 730 days (2 years)
6. Confirm transaction

**Result:** Public page shows "Liquidity locked until May 2028"

---

## 🎁 Airdrop Strategy

### Allocation: 10M ATTR (10% of initial 100M)

**Why 10%?**

- Industry standard: 5-15%
- Rewards early adopters meaningfully
- Doesn't dilute treasury runway

### Recipient Tiers

```
10M ATTR Airdrop Breakdown:
├── Tier 1: Power Users (60% = 6M)
│   ├── Active NFT minters (3+ mints): 4M
│   ├── Governance participants: 1M
│   └── Beta testers: 1M
│
├── Tier 2: Community (30% = 3M)
│   ├── Discord OGs (6+ months): 1.5M
│   ├── Twitter engagers: 1M
│   └── Event participants: 0.5M
│
└── Tier 3: Early Supporters (10% = 1M)
    ├── First 100 Discord joins: 0.5M
    ├── First 100 NFT holders: 0.4M
    └── Referral champions: 0.1M
```

### Anti-Sybil Protection

| Measure                           | Purpose                        |
| --------------------------------- | ------------------------------ |
| **Minimum 1 NFT minted**          | Proves real platform usage     |
| **Discord level 5+ or 3+ months** | Time-based, expensive to fake  |
| **Snapshot at TGE**               | Prevents last-minute farming   |
| **Linear vesting >10K claims**    | 3-month vest for large amounts |

### Airdrop Sequence

1. **T-7 days:** Publish criteria + snapshot date
2. **TGE (Day 0):** Take snapshot, open claim window
3. **Days 0-14:** 2-week claim period
4. **Day 30:** Unclaimed tokens return to treasury
5. **Ongoing:** Large claims vest over 3 months

---

## 📊 Recommended Tokenomics (Final)

### 100M Initial Mint Allocation

```
┌─────────────────────────────────────────────────────────┐
│                    100M ATTR Treasury                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. Liquidity (15M - 15%)                                 │
│     └── Uniswap V3: ATTR/WETH                            │
│     └── 50% LP locked 2 years (via UncX)                │
│                                                          │
│  2. Team & Advisors (25M - 25%)                           │
│     └── 4-year vest, 1-year cliff (Sablier)             │
│     └── Governance-controlled release                    │
│                                                          │
│  3. Airdrop (10M - 10%)                                   │
│     └── Power users: 6M                                  │
│     └── Community: 3M                                    │
│     └── Early supporters: 1M                            │
│                                                          │
│  4. Operations (35M - 35%)                                │
│     └── 18-month runway                                  │
│     └── Salaries, marketing, legal, CEX fees             │
│                                                          │
│  5. Ecosystem Reserve (15M - 15%)                         │
│     └── Partnerships, grants, integrations              │
│     └── Strategic opportunities                          │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Comparison to Industry

| Metric                  | Your Plan  | Uniswap | Aave  | Compound | Status          |
| ----------------------- | ---------- | ------- | ----- | -------- | --------------- |
| **Initial circulating** | ~25M (25%) | 60%     | 30%   | 40%      | ✅ Conservative |
| **Team allocation**     | 25%        | 20%     | 20%   | 22%      | ✅ Standard     |
| **Community rewards**   | 10%        | 15%     | 55%\* | 58%\*    | ✅ Appropriate  |
| **Treasury runway**     | 50M (50%)  | ~20%    | ~25%  | ~20%     | ✅ Strong       |

\*Includes staking/liquidity rewards distributed over time

### Key Principles Applied

- ✅ **10% initial supply** — Conservative, room for growth
- ✅ **Hard cap 1B** — Immutable, no surprise inflation
- ✅ **Vesting on all insider allocations** — Shows commitment
- ✅ **LP locking** — Trust signal, prevents rug
- ✅ **Airdrop to users** — Rewards real adoption
- ✅ **18-month runway** — Can operate without emergency mints

---

## 🎯 The Liquidity-Airdrop Paradox & Solutions

### The Central Tension

**Concern:** "DEX liquidity enables airdrop recipients to sell rather than use the token."

**Reality:** This is a valid concern—but the alternative (no liquidity) creates a worse problem: a token with no perceived value, no price discovery, and no functional economy.

### The Three Scenarios

```
Scenario A: No Liquidity
┌────────────────────────────────────────┐
│ 1. Airdrop 10M ATTR to users           │
│ 2. No DEX, no price discovery           │
│ 3. Users can't sell → frustration       │
│ 4. "Why use this for NFTs? It's         │
│    worthless anyway"                   │
│ 5. Token has no market value            │
└────────────────────────────────────────┘

Scenario B: Liquidity + Poor Design ❌
┌────────────────────────────────────────┐
│ 1. Airdrop 10M ATTR instantly          │
│ 2. DEX live, price = $0.01             │
│ 3. Immediate dump → price $0.001        │
│ 4. Death spiral, reputation ruined      │
└────────────────────────────────────────┘

Scenario C: Liquidity + Smart Design ✅
┌────────────────────────────────────────┐
│ 1. Airdrop with vesting & conditions    │
│ 2. DEX live, price discovery works      │
│ 3. Some sell (expected, healthy)        │
│ 4. Buyers enter at fair price           │
│ 5. Utility creates natural demand       │
│ 6. Price finds equilibrium              │
└────────────────────────────────────────┘
```

### Why Liquidity is Essential

**Liquidity doesn't just enable selling—it enables:**

- ✅ Price discovery (what is ATTR actually worth?)
- ✅ Buyer confidence (they can exit if needed)
- ✅ Market making (arbitrage keeps prices fair)
- ✅ Psychological value ("this token has real worth")

**Without liquidity:**

- ❌ No perceived value → no incentive to hold
- ❌ Can't demonstrate market cap to exchanges/partners
- ❌ Users hoard for "someday" but never engage
- ❌ Token feels like a points system, not real money

### Smart Airdrop Design (Forcing Function)

The goal: **Reward early adopters while aligning long-term holding behavior.**

#### Strategy 1: Vested Airdrops

```
Traditional Airdrop:
Day 0: User gets 10,000 ATTR → Can dump immediately

Vested Airdrop (Recommended):
Day 0: Stream starts, 10,000 ATTR unlocks over 3 months
Month 1: 3,333 available → User thinks "sell 1/3 or wait?"
Month 2: 3,333 more → Price stable, utility is live
Month 3: 3,334 final → By now, they've used ATTR for NFTs
```

**Psychology:** Endowment effect—people value things more when they already own them. Vesting makes them "feel" ownership before they can fully sell.

**Implementation:** Use Sablier for streaming airdrops.

#### Strategy 2: Utility-Gated Eligibility

Only airdrop to users who **demonstrate utility behavior:**

| Criteria           | What It Proves       | Sell Likelihood |
| ------------------ | -------------------- | --------------- |
| Minted 3+ NFTs     | Active platform user | Low             |
| Held NFTs 30+ days | Not a flipper        | Low             |
| Governance voter   | Cares about protocol | Very Low        |
| Discord Level 10+  | Engaged community    | Medium          |

**Avoid:** Wallet age, transaction count, ETH holding—farmable metrics.

#### Strategy 3: Claim-and-Stake

Force immediate action to claim:

```
Airdrop Flow:
1. User eligible for 10,000 ATTR
2. MUST stake for 30 days minimum to claim
3. Staking rewards start immediately
4. After 30 days: can unstake, sell, or keep earning
5. Most keep staking → habit of holding formed
```

#### Strategy 4: Graduated Unlock

```
Phase 1 (Month 1): 25% available
Phase 2 (Month 3): 25% available (must mint 1 NFT to unlock)
Phase 3 (Month 6): 25% available (must hold ATTR 30+ days)
Phase 4 (Month 12): 25% available (must refer 1 new user)
```

**Forces engagement** with core product before full unlock.

### The NFT Minting Flywheel

**The real retention mechanism: Make ATTR valuable to USE, not just HOLD.**

```
┌──────────────────────────────────────────┐
│ Users need ATTR to mint NFTs            │
│         ↓                                │
│ NFTs have value (art, reputation)         │
│         ↓                                │
│ Successful drops attract new users        │
│         ↓                                │
│ More minters = more ATTR demand           │
│         ↓                                │
│ (Back to top)                            │
└──────────────────────────────────────────┘
```

**If your NFTs are valuable, people won't sell ATTR—they'll hoard it to mint more.**

### Recommended Hybrid Airdrop for ATTR

```
10M ATTR Airdrop (Revised):

Tier 1: "True Believers" (40% = 4M ATTR)
├── Who: Minted 5+ NFTs, governance voters, 6+ month Discord
├── Distribution:
│   ├── 50% immediate (reward past behavior)
│   └── 50% vested 6 months (Sablier stream)
└── Why they'll hold: Already invested in ecosystem

Tier 2: "Community" (40% = 4M ATTR)
├── Who: Active Discord, Twitter engagers, event attendees
├── Distribution:
│   ├── 25% immediate
│   ├── 75% vested over 4 months
│   └── CONDITION: Must mint 1 NFT to start vesting
└── Why they'll hold: Locked until they engage

Tier 3: "Early Birds" (20% = 2M ATTR)
├── Who: First 100 Discord, first 100 NFT holders
├── Distribution: 100% immediate
└── Why they'll hold: OGs have emotional attachment
```

### Realistic Sell Pressure Math

```
With Smart Design:
├── Airdrop: 10M ATTR to 2,000 users (avg 5,000 each)
├── Immediate sellers: 20% (2M ATTR)
│   └── Price impact: -15% (temporary)
│   └── These were never going to be users anyway
├── Gradual sellers: 30% (3M over 3 months)
│   └── Minimal impact (absorbed by buyers)
└── Holders: 50% (5M ATTR)
    └── Staking, minting, governance

$100K liquidity absorbs 2M sell pressure = ~$0.005 impact
Recoverable within days if utility is live
```

### Final Recommendation: The Sequence

**The order matters more than any single decision:**

1. **NFT minting utility LIVE** (ATTR has immediate, concrete use)
2. **DEX liquidity added** (price discovery, functional economy)
3. **Airdrop with vesting** (rewards aligned with ecosystem)
4. **First major NFT drop announced** (creates immediate ATTR demand)
5. **Staking rewards live** (incentivizes holding over selling)

**This sequence creates:**

- ✅ Utility demand (people need ATTR)
- ✅ Price discovery (market values the token)
- ✅ Holder alignment (vesting prevents reflexive dumping)
- ✅ Organic growth (users bring users)

### Key Insight

**"Don't airdrop without liquidity" doesn't mean enable dumping.**

It means: **Ensure your token has a functioning economy when users receive it.**

- Liquidity = Token has value
- Vesting = Recipients can't immediately destroy that value
- Utility = They actually want to keep it

---

## 📝 Executive Summary

### The Complete ATTRToken Launch Plan

This document covers the full lifecycle of deploying and launching the ATTRToken on Base Mainnet. Here's the condensed version:

#### Contract Specs

- **Token**: ATTR (Attribute Point)
- **Type**: ERC20 with Burn, Cap, Permit, Votes, AccessControl
- **Supply**: 1B cap, 100M initial mint (10%)
- **Chain**: Base Mainnet (8453)

#### Treasury Allocation (100M Initial)

```
15M (15%) → Liquidity (ATTR/WETH on Uniswap V3, 50% LP locked 2yr)
25M (25%) → Team (4yr vest, 1yr cliff via Sablier)
10M (10%) → Airdrop (tiered, vested, utility-gated)
35M (35%) → Operations (18-month runway)
15M (15%) → Ecosystem Reserve (partnerships, grants)
```

#### Critical Path

1. **Pre-Launch**: Test on Sepolia, generate fresh mainnet keys, set up Gnosis Safe
2. **Deploy**: Token → Liquidity → Verify on BaseScan
3. **Secure**: Transfer roles to Safe, revoke deployer, lock 50% LP
4. **Launch**: Utility LIVE → Airdrop with vesting → Staking rewards
5. **Monitor**: Treasury reports, holder analytics, price stability

#### Key Decisions Made

- ✅ **ATTR/WETH pool**: Best for Base L2, add USDC later
- ✅ **10% initial supply**: Conservative, industry-standard
- ✅ **Vested airdrops**: Prevents immediate dumping
- ✅ **LP locking**: 50% for 2 years (trust signal)
- ✅ **Utility first**: NFT minting must be live before airdrop

#### Risk Mitigation

- Deployer key rotated (not reused from testnet)
- Multisig admin (not single EOA)
- Vesting on all insider allocations
- Hard cap (no surprise inflation)
- 18-month treasury runway

#### Success Metrics

- Contract verified on BaseScan
- $100K+ liquidity with 50% locked
- 2,000+ airdrop recipients engaged
- NFT minting utility generating ATTR demand
- Price stability within 30 days of launch

---

## ✅ Final Pre-Launch Checklist

**Security:**

- [ ] Fresh mainnet deployer wallet generated
- [ ] Gnosis Safe created and tested
- [ ] All private keys stored securely
- [ ] `.env` never committed to git

**Configuration:**

- [ ] `.env` updated with mainnet values
- [ ] Tokenomics confirmed (1B cap, 100M initial)
- [ ] RPC endpoint is private/reliable
- [ ] BaseScan API key obtained

**Testing:**

- [ ] All 40+ Hardhat tests pass
- [ ] Sepolia deployment successful
- [ ] End-to-end testnet verification complete
- [ ] NFT payment flow tested with ATTR

**Deployment:**

- [ ] Deployer wallet funded (0.05+ ETH)
- [ ] Deploy script ready
- [ ] Verification command prepared
- [ ] Role transfer script ready
- [ ] Delegation script ready

**Post-Deployment:**

- [ ] Contract verified on BaseScan
- [ ] Roles transferred to multisig
- [ ] Deployer roles revoked
- [ ] Treasury voting power activated
- [ ] Monitoring set up
- [ ] Documentation updated with addresses

---

**Last Review Date**: 2026-04-03  
**Reviewed By**: Cascade AI  
**Next Review**: Before mainnet deployment

**Status**: ⏳ Ready for final testing phase
