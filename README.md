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
