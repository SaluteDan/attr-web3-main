# ATTR Web3 Lib

Smart contracts, contract tests, deployment scripts, and Basescan verification command for ATTR.

## Setup

```bash
npm install
cp .env.example .env
```

## Common Commands

```bash
npm run compile
npm test
npm run test:fuzz
npm run lint:sol
npm run verify:contract
```

The backend calls `npm run verify:contract` with a JSON payload on stdin. This repo owns the local Hardhat configuration and contract sources used for Basescan verification.

When installed as a package dependency, the backend calls the
`attr-web3-verify-contract` binary from `node_modules/.bin`.

## Contract Overview

| Contract                   | Description                                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATTRToken`                | ERC20 governance token with capped supply, permit, votes, and access control                                                                                    |
| `NFTCollection`            | Factory-deployed creator NFT with EIP-712 voucher minting, `basePrice + creatorTip` routing, mutable `contractURI`, and optional ATTR payment via `ATTRSpender` |
| `ATTRDeployer`             | Factory for `NFTCollection` + `PaymentSplitter` pairs; auto-authorises each collection in `ATTRSpender`                                                         |
| `ATTRSpender`              | Shared ATTR-token payment proxy — users approve once, all authorised collections pull through this contract                                                     |
| `MembershipToken`          | Tiered membership NFT (ERC721Votes + ERC2981) that absorbs the former `GovernanceNFT`; max 50 000 tokens                                                        |
| `MembershipSaleSplitter`   | Immutable 70/30 ETH splitter — routes membership sale proceeds to treasury (70%) and LP capital (30%)                                                           |
| `MembershipFeeDistributor` | Synthetix-style index distributor — deposits ETH/ERC20 LP fee proceeds and lets membership NFT holders claim their pro-rata share                               |
| `PaymentSplitter`          | Pull-payment splitter for royalty and mint proceeds; supports dynamic payee/share updates                                                                       |

## Deployment Sequence

Deploy contracts in this order for proper integration:

| Step | Contract                   | Script                                       | Dependencies                                          | Notes                                           |
| ---- | -------------------------- | -------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| 1    | `ATTRToken`                | `scripts/deploy/token.ts`                    | None                                                  | ERC20 governance token                          |
| 2    | `ATTRSpender`              | `scripts/deploy/attrSpender.ts`              | ATTR_TOKEN_ADDRESS                                    | Shared payment proxy for collections            |
| 3    | `ATTRDeployer`             | `scripts/deploy/factory.ts`                  | ATTR_SPENDER_CONTRACT (optional)                      | Collection factory; auto-authorizes collections |
| 4    | `MembershipSaleSplitter`   | `scripts/deploy/membershipSaleSplitter.ts`   | PLATFORM_TREASURY_ADDRESS, LIQUIDITY_RECEIVER_ADDRESS | 70/30 ETH splitter for membership sales         |
| 5    | `MembershipToken`          | `scripts/deploy/membershipToken.ts`          | None                                                  | Tiered membership NFT                           |
| 6    | `MembershipFeeDistributor` | `scripts/deploy/membershipFeeDistributor.ts` | MEMBERSHIP_TOKEN_ADDRESS, DAO_MULTISIG_ADDRESS        | LP fee distributor for holders                  |

### Post-Deployment Wiring

After deploying, connect the contracts:

1. **Transfer ATTRSpender ownership to factory** (if deployed):

   ```bash
   npx hardhat run scripts/transfer/attrSpenderOwnership.ts --network baseSepolia
   ```

2. **Set MembershipToken payment receiver** to splitter:

3. **Set MembershipFeeDistributor snapshot** (DAO must execute):
   ```solidity
   // Once public mint ends, set the divisor for reward calculations
   // totalSupply = current total supply from MembershipToken.totalSupply()
   distributor.setTotalMintedSnapshot(membershipToken.totalSupply())
   ```

## Error Handling

All contracts use a shared custom-error library. See [`contracts/docs/ERRORS.md`](contracts/docs/ERRORS.md) for the full reference with severity tiers and per-contract coverage.

## Liquidity Flywheel

```text
Membership NFT Sale
        ↓
MembershipSaleSplitter
  70% → Treasury operations
  30% → ATTR/WETH LP capital
              ↓
        LP fee accrual
  50% → Treasury
  50% → MembershipFeeDistributor → NFT holders pro-rata
```

## Roadmap / Planned Changes

### Tier-Based Voting Weight

**Status:** Architecture prepared, implementation pending

MembershipToken uses `ERC721Votes` which defaults to **1 vote per NFT**. Future upgrade will implement tier-weighted voting:

- Tier 1 holders: 2x voting weight
- Tier 2 holders: 1x voting weight

**Implementation approach:** Override `getVotes()` and `getPastVotes()` to multiply by tier multiplier. Consider adding `votesPerTier` mapping now (defaulting to 1) to enable future governance upgrades without redeployment.

### Tier-Based Fee Distribution

**Status:** Requires contract modification

Currently `MembershipFeeDistributor` distributes LP fees **equally per token** regardless of tier. Future upgrade will weight distributions by tier:

- Tier 1 holders: Bonus multiplier on claimable rewards
- Requires: `tierMultipliers` mapping + modified `claimETH()`/`claimERC20()` logic

### Backend TypeScript Integration

The package now exposes TypeChain-generated types for contract interaction:

```typescript
import {
  ATTRToken,
  ATTRToken__factory,
  MembershipToken,
  MembershipToken__factory,
  MembershipFeeDistributor,
  NFTVoucherStruct,
} from "attr-web3";

// Factory classes include ABI + bytecode for deployment/attachment
const token = ATTRToken__factory.connect(address, provider);

// Struct types for contract calls
const voucher: NFTVoucherStruct = {
  tokenId: 1n,
  minPrice: 1000000000000000000n, // 1 ETH
  uri: "ipfs://...",
  creator: "0x...",
  royaltyBasisPoints: 500,
  signature: "0x...",
};
```

**Backend usage:**

- Import contract types for type-safe viem/ethers interactions
- Use factory classes for deterministic contract attachment
- Access struct types for encoding complex parameters

### Backend Rewiring Guide

**Before (string-based, no type safety):**

```typescript
import { ethers } from "hardhat";

// String lookup - no compile-time validation
const MembershipToken = await ethers.getContractFactory("MembershipToken");
const membership = MembershipToken.attach(address);

// Method calls are untyped - typos only fail at runtime
await membership.adminMintMembership(recipient, tier, uri); // could typo method name
```

**After (type-safe with exposed interfaces):**

```typescript
import { MembershipToken, MembershipToken__factory } from "attr-web3";

// Factory class provides typed contract instance
const membership: MembershipToken = MembershipToken__factory.connect(
  address,
  signer,
);

// Full autocomplete + compile-time checking
await membership.adminMintMembership(
  recipient, // string - TypeScript validates
  tier, // number
  metadataURI, // string
);

// Access on-chain data with typed returns
const tier: bigint = await membership.tokenTiers(tokenId);
const price: bigint = await membership.tierPrices(tier);
```

**Key Benefits:**

- Compile-time validation of contract method names
- Type checking on all parameters (no more passing strings where numbers expected)
- Auto-completion for contract state variables and methods
- Struct types for complex parameters (e.g., `NFTVoucherStruct`)
