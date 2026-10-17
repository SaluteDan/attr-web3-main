# ATTR Web3 Contracts & Protocol SDK

Smart contracts, testing harnesses, deployment tooling, and Basescan verification scripts for the ATTR protocol on Base.

---

## 1. Setup & Requirements

### Repo Development & CI
* **Node.js**: `>=22.13.0` (Hardhat v3 requirement — enforced via `devEngines` and `.nvmrc`).
* **Package Manager**: npm.
* **Toolchains**: Hardhat v3 (`@nomicfoundation/hardhat-viem`) + Foundry (`forge`).

```bash
npm install
cp .env.example .env
```

### Published Runtime (SDK Consumers)
The published npm package (`attr-web3` / `dist/src/index.js`) exports compiled contract ABIs, bytecode, and Viem TypeScript interfaces.
* `engines.node`: `>=18.20.0` (native import attributes `with { type: "json" }`).
* Consumers on Node 20 (`attr-backend`, `frontend-ui`) install cleanly with zero `EBADENGINE` warnings.

---

## 2. Common Development Commands

```bash
# Compilation
npm run compile        # Hardhat compile (Cancun, viaIR, 200 optimizer runs)
forge build            # Foundry compile

# Testing
npm test               # Run Hardhat TypeScript test suite
npm run test:contracts # Run Hardhat tests
npm run test:fuzz      # Run Foundry fuzz & invariant test suite
npm run gate           # Pre-PR gate: compile + test:contracts + lint:sol

# Analysis & Benchmarks
npm run lint:sol       # Solhint Solidity linter
npm run slither        # Slither static analyzer
npm run gas:check      # Check gas snapshot drift (report-only)

# Deployment
npm run deploy:all     # Single-run deployment & wiring of the full protocol suite
npm run verify:contract # Basescan source code verification helper
```

---

## 3. Contract Ecosystem Overview

| Contract | Category | Description | Access / Governance |
|---|---|---|---|
| **`ATTRToken.sol`** | Core Token | Native $ATTR ERC-20 utility & governance token (`ERC20Burnable`, `ERC20Capped`, `ERC20Permit`, `ERC20Votes`). Fixed immutable cap of 1,000,000,000 ATTR minted at deploy. | **Immutable**: No `MINTER_ROLE`, no `mint()`, no admin keys. |
| **`ATTROnboardingVault.sol`** | Treasury Escrow | Autonomous escrow vault holding the 150,000,000 ATTR welcome-grant pool. Only `MembershipToken` may call `disburseGrant`. | **DAO Timelock / Multisig** (`Ownable`) with timelocked emergency rescue. |
| **`MembershipToken.sol`** | Membership NFT | Tiered membership collection (Tier 1 & Tier 2) with 50,000 hard collection cap (`MAX_SUPPLY`). Supports dual ETH & native USDC checkout, stepped pricing tranches, and immediate liquid welcome grants (2,500 T1 / 1,000 T2 ATTR). | **Platform Admin / DAO** (`Ownable`). |
| **`MembershipFeeDistributor.sol`** | Revenue Sharing | Tier-weighted (T1 = 225, T2 = 100), transfer-aware continuous fee-sharing engine for ETH and ERC-20s. Payouts use frozen interval denominators. (*Phase 2 Platform Volume Share — Day 1 deferred*). | **DAO Owner** (`Ownable`) + authorized keeper for thresholded pushes. |
| **`ATTRDeployer.sol`** | Creator Factory | Factory for deploying creator `NFTCollection` contracts and revenue `PaymentSplitter` contracts. Auto-authorizes deployed collections in `ATTRSpender`. | **Platform Admin / Backend** (`Ownable`). |
| **`ATTRSpender.sol`** | Payment Proxy | Shared security proxy for ATTR token payments. Allows collectors to approve once while authorized creator collections pull payments safely. | **ATTRDeployer Factory** (`Ownable`). |
| **`NFTCollection.sol`** | Creator NFTs | Creator collection supporting EIP-712 voucher-based mints, primary mints, and tips in ETH or $ATTR. | **Creator / Admin** (`Ownable`). |
| **`PaymentSplitter.sol`** | Revenue Split | Pull-payment splitter distributing primary sales and secondary royalties across creator payees. | **Creator / Deployer** (`Ownable`). |
| **`VestingLockCampaignFactory.sol`** | Staking Factory | Owner-controlled factory deploying isolated `VestingLockCampaign` instances for community lock-to-earn staking. | **DAO / Platform Admin** (`Ownable`). |
| **`VestingLockCampaign.sol`** | Staking Pools | Community lock-to-earn staking pools where users lock ATTR for configurable periods to earn reward allocations. | **Factory / Creator**. |

---

## 4. Tokenomics & Treasury Architecture

The protocol uses a **Pre-Minted Treasury & Closed-Loop Recycling Model** (settled in `specs/attr-issuance-preminted-treasury.md` and `specs/membership-entitlement.md` §3B):

```
                       ┌─────────────────────────────────────────┐
                       │           Deploy ATTR (1B Cap)          │
                       └────────────────────┬────────────────────┘
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
     ┌─────────────────────────────┐                 ┌─────────────────────────────┐
     │   Day-1 Liquid: 300M (30%)  │                 │    Locked Buckets: 700M     │
     └──────────────┬──────────────┘                 └──────────────┬──────────────┘
                    │                                               │
         ┌──────────┴──────────┐                                    ▼
         ▼                     ▼                     ┌─────────────────────────────┐
┌─────────────────┐   ┌─────────────────┐            │  3rd-Party Vesting Platform │
│   Onboarding    │   │   Store Pack    │            │   (Sablier, Hedgey, etc.)   │
│     Vault       │   │    Inventory    │            ├─────────────────────────────┤
│   (150M ATTR)   │   │   (150M ATTR)   │            │ • Team (150M - 12m cliff)   │
└────────┬────────┘   └────────┬────────┘            │ • Reserve (150M - Safe)     │
         │                     │                     │ • Staking (120M - 36m lin)  │
         ▼                     │                     │ • Marketing (100M - 6m cl)  │
 Membership Grants             │ ◄─── Recycled ────┐ │ • Advisors (60M - 12m cl)   │
 (drawn on mint)               ▼      (Spent ATTR) │ │ • LP Incentives (60M)       │
                          Store Sales ─────────────┘ │ • DEX Seed (60M - Locked)   │
                                                     └─────────────────────────────┘
```

1. **Deterministic 1B Supply Cap**:
   * Exactly 1,000,000,000 ATTR created at genesis.
   * `MINTER_ROLE` is permanently deleted. No contract or admin can ever inflate the token supply.
2. **Day-1 Operational Float (30% / 300,000,000 ATTR)**:
   * **150M Membership Onboarding Vault**: Dedicated exclusively to `MembershipToken` grants. With `MAX_SUPPLY = 50,000` and maximum grant of 2,500 ATTR, lifetime grant demand is mathematically capped at $50,000 \times 2,500 = 125,000,000\text{ ATTR}$, guaranteeing the vault cannot be exhausted under valid collection parameters.
   * **150M Store Pack Inventory**: Sits in Store reserves. In-product ATTR spend recycles back into this pool, keeping the store evergreen without inflating supply. Board stakes on competitive leaderboards are burned via `ATTRToken.burn()`.
3. **Locked Allocations (70% / 700,000,000 ATTR)**:
   * Deposited directly into audited third-party streaming/vesting escrows (Sablier / Hedgey). No custom un-audited timelock contracts.
4. **Platform Volume Share (Phase 2)**:
   * All legacy "LP fee share" references are retired.
   * When marketplace volume matures, `MembershipFeeDistributor` distributes real protocol volume (marketplace primary fees + secondary royalties) to members. Day 1 launch starts with `feeDistributor = address(0)`.

---

## 5. Deployment Guide

### Single-Run Deployment & Setup (Recommended)

We provide an automated script that deploys all contracts in exact dependency order, configures payment tokens, transfers required roles, and funds the grant vault in a single run:

```bash
# Local simulation
npx hardhat run scripts/deploy/all.ts

# Base Sepolia Testnet
npm run deploy:all -- --network baseSepolia

# Base Mainnet
npm run deploy:all -- --network baseMainnet
```

#### What `scripts/deploy/all.ts` executes automatically:
1. Deploys **`ATTRToken`** (1,000,000,000 ATTR minted to the distribution address).
2. Deploys **`MembershipToken`** (configured with name, symbol, pricing, and 50k cap).
3. Deploys **`ATTROnboardingVault`** (pre-binding `membershipToken.address` and DAO Timelock).
4. Configures **`MembershipToken.configurePaymentTokens(vault, usdc)`** (verifies vault authorization).
5. Funds **`ATTROnboardingVault`** with the 150,000,000 ATTR welcome-grant pool directly from deployer allocation, and forwards remaining unallocated tokens to `PLATFORM_TREASURY_ADDRESS`.
6. Deploys **`ATTRSpender`**.
7. Deploys **`ATTRDeployer`** (Collection Factory).
8. Transfers **`ATTRSpender`** ownership to **`ATTRDeployer`** and verifies ownership on-chain.
9. Deploys **`VestingLockCampaignFactory`** for community staking pools.
10. Deploys **`MembershipFeeDistributor`** (Phase 2 component).
11. Generates ready-to-copy `.env` environment variables and BaseScan verification commands.

---

### Step-by-Step Manual Deployment (Reference)

If deploying contracts individually:

```bash
# 1. Deploy ATTRToken (requires PLATFORM_TREASURY_ADDRESS on live networks)
npx hardhat run scripts/deploy/token.ts --network baseSepolia

# 2. Deploy MembershipToken
npx hardhat run scripts/deploy/membershipToken.ts --network baseSepolia

# 3. Deploy ATTRSpender
npx hardhat run scripts/deploy/attrSpender.ts --network baseSepolia

# 4. Deploy ATTRDeployer Factory
npx hardhat run scripts/deploy/factory.ts --network baseSepolia

# 5. Transfer ATTRSpender ownership to Factory
npx hardhat run scripts/transfer/attrSpenderOwnership.ts --network baseSepolia

# 6. Deploy Community Vesting Factory
npx hardhat run scripts/deploy/vestingFactory.ts --network baseSepolia
```

---

## 6. TypeScript SDK & Consumer Integration

The `attr-web3` package exports typed contract ABIs, bytecode, and Viem struct definitions for use in backend microservices and frontend clients:

```typescript
import {
  MembershipTokenABI,
  ATTROnboardingVaultABI,
  ATTRTokenABI,
  NFTCollectionABI,
  type NFTVoucher,
  type PermitSignature
} from "attr-web3";
import { getContract } from "viem";

// Example: Initialize typed contract instance with Viem
const membership = getContract({
  address: process.env.MEMBERSHIP_TOKEN_CONTRACT as `0x${string}`,
  abi: MembershipTokenABI,
  client: publicClient
});

// Read public tier price
const tier1Price = await membership.read.tierPrices([1n]);

// Prepare EIP-712 NFT Voucher struct
const voucher: NFTVoucher = {
  recipient: "0x...",
  uri: "ipfs://QmCollectionNFT",
  nonce: "unique-nonce-123",
  currency: "0x0000000000000000000000000000000000000000",
  basePrice: 100000000000000000n, // 0.1 ETH
  creatorTip: 0n,
  deadline: 1770000000n,
  signature: "0x..."
};
```

---

## 7. Security, Audits & Quality Gates

* **Zero Minting Keys**: Supply cap is enforced mathematically. Post-genesis minting is impossible.
* **Checks-Effects-Interactions (CEI)**: Grant disbursement occurs prior to external ERC-721 receiver callbacks, with all mint entrypoints protected by OpenZeppelin `ReentrancyGuard`.
* **Deep Invariant Fuzzing**: The protocol fee sharing and token accounting passed 10,000-run / 2.56-million-call invariant fuzz testing without a single revert or break of conservation (`claimed + dust <= deposited`).
* **Independent Pre-Audit Reviews**: Full multi-agent QA (`PASS`) and Security Auditor (`SHIP`) sign-offs documented in `specs/test-briefs/`.
* **Custom Errors**: All contracts use custom errors from `contracts/Errors.sol`. Detailed error coverage and severity levels are cataloged in [`contracts/docs/ERRORS.md`](contracts/docs/ERRORS.md).
