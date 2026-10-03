# ARCHITECTURE.md — attr-web3-main (Contracts)

_Local architecture for the contracts repo. Last reviewed 2026-10-03._
_System-level view: workspace `docs/ARCHITECTURE.md`. Engineering bible: `specs/grail/`._

> **Before writing any code, read `agents/README.md`** (workspace standing rules)
> and the Contracts Engineer card's "Read before writing" block. Rules are known
> before code is written — not fixed at review.

## What this repo is

Solidity smart contracts, Hardhat + Foundry tests, deploy/verify scripts, and the
**published npm package `attr-web3`** (v3.0.5) consumed by `attr-backend-main`
for contract deployment and Basescan verification. Chain: **Base**
(Base Sepolia testnet first).

Toolchain: Hardhat v3 + `hardhat-viem` + `hardhat-verify` +
`hardhat-node-test-runner` + `hardhat-viem-assertions`; Foundry for fuzz.
**No ethers** (viem everywhere); TypeChain removed — contracts ship direct
ABI/bytecode exports from `dist/`.

## Layout

```
contracts/            Solidity sources + contracts/docs/
  ATTRToken.sol         ERC20: capped, burnable, permit, votes, access control, pausable
  ATTRDeployer.sol      Factory: deploys NFTCollection (+ optional PaymentSplitter), auto-authorises in ATTRSpender
  ATTRSpender.sol       Shared ATTR payment proxy: one user approval, authorised collections pull payments
  NFTCollection.sol     Edition NFT: EIP-712 voucher mint (redeem / redeemWithApproval), royalties, spender routing
  MembershipToken.sol   Membership NFT (ERC721Votes + ERC2981); absorbed the former GovernanceNFT
  MembershipSaleSplitter.sol   Immutable 70/30 ETH splitter (treasury / LP)
  MembershipFeeDistributor.sol Synthetix-style pro-rata LP-fee distributor to membership holders
  PaymentSplitter.sol   Pull-payment splitter; dynamic payees/shares (royalty + mint proceeds)
  VestingLockCampaign.sol + VestingLockCampaignFactory.sol  Reusable lock-to-earn campaigns
  Errors.sol            Shared custom-error catalogue
  docs/                 ERRORS, ROYALTY_CONFIGURATION, VESTING_LOCK_CAMPAIGNS, MAINNET_READINESS_REPORT
scripts/
  deploy/               token, attrSpender, factory, membershipToken/SaleSplitter/FeeDistributor, vestingFactory, vestingLockCampaign, test-collection
  check/                balance, attr-spender
  transfer/             attrSpenderOwnership, delegate-treasury-votes, token-roles
  mint/                 membershipToken(+rewired)
  verify-contract.ts    Basescan verification entry
test/
  contracts/*.test.ts   Hardhat (viem) unit tests
  fuzz/*.t.sol          Foundry fuzz/invariant tests
docs/
  deployment/           archive index (historical docs are in docs/archive/deployment/; see INDEX.md)
  test/                 TESTING_STRATEGY.md, INSTALL_FOUNDRY.md
bin/verify-contract.cjs Published verify binary (attr-web3-verify-contract)
```

## Contract relationships

- **ATTRDeployer** is the collection factory. On deploy it wires the new
  `NFTCollection` into **ATTRSpender** (ownership of the spender sits with the
  factory), and deploys a **PaymentSplitter** when there are ≥2 creators.
- **NFTCollection** verifies backend-signed EIP-712 vouchers, then mints. Payment
  routing: ATTR → `ATTRSpender.collectPayment(payer,…)`; other ERC20 →
  `safeTransferFrom(voucher.recipient,…)`; ETH → exact `msg.value` forwarded.
  Funds pull from **`voucher.recipient`** (ERC-4337-safe), not `msg.sender`.
- **MembershipToken** is standalone (tiers, votes, royalties); its sale proceeds
  route through **MembershipSaleSplitter** → **MembershipFeeDistributor** to
  holders.
- **VestingLockCampaignFactory** deploys isolated **VestingLockCampaign**
  instances (immutable per-campaign terms; treasury pre-funds rewards).

## Deploy order

`ATTRToken` → `ATTRSpender` → `ATTRDeployer` → `MembershipSaleSplitter` →
`MembershipToken` → `MembershipFeeDistributor` → `VestingLockCampaignFactory`.
Post-deploy wiring (transfer spender ownership to factory, set membership payment
receiver, `setTotalMintedSnapshot`) is detailed in `README.md`.

## Commands

```bash
npm run compile            # hardhat compile
npm test / test:contracts  # hardhat test  (plain — do NOT pass a glob)
npm run test:fuzz          # forge test
npm run coverage           # solidity-coverage
npm run lint:sol           # solhint
npm run deploy:token | deploy:factory | deploy:vesting-factory | deploy:membership
npm run verify:contract
```

**Gotcha:** `test:contracts` must remain **plain `hardhat test`** — the suite is
scoped via `paths.tests = ./test/contracts` in `hardhat.config.ts`. Passing a
literal `test/contracts/**/*.test.ts` arg breaks node's ESM test runner
(ERR_MODULE_NOT_FOUND; fixed in PR #1).

## Working rules (see `agents/contracts-engineer.md`)

- NatSpec on public functions; custom errors via `Errors.sol`.
- Every behaviour change ships tests; fuzz where math/access control matters.
- Update `contracts/docs/` when behaviour or invariants change.
- Branch-only; **no mainnet deploy without Daniel's in-session approval**.

## Known doc debt

- `contracts/docs/MAINNET_READINESS_REPORT.md` is **stale** (pre-dates the
  GovernanceNFT→MembershipToken merge and vesting campaigns) — re-baseline before
  any readiness sign-off.
- `docs/deployment/INDEX.md` links files that no longer exist — see
  workspace `docs/DOC-INDEX.md`.
