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

## Known Limitations & Planned Contract Changes

The following items are intentionally deferred until a coordinated contract upgrade + factory redeploy. They are documented here (and referenced in inline `TODO` comments) so context isn't lost between sessions.

### 1. Mutable `contractURI` / accurate `fee_recipient` in IPFS metadata

**Current behaviour:** `NFTCollection._contractURI` is set once in the constructor and cannot be updated. Because collection metadata must be uploaded to IPFS _before_ the deployment tx (so the URI can be passed to the constructor), the `fee_recipient` field in the IPFS JSON is set to `royaltyCreators[0].address` as a placeholder. For collections with 2+ creators, the actual royalty receiver on-chain is the deployed `PaymentSplitter` — not the placeholder.

**Why this is acceptable today:** On-chain ERC2981 (`royaltyInfo()`) is authoritative and is what OpenSea, Blur, LooksRare, and other major marketplaces use to route royalties. The `fee_recipient` field in contract-level metadata is a legacy OpenSea V1 convention.

**Planned fix:** Add an owner-only `setContractURI(string)` + `ContractURIUpdated` event to `NFTCollection.sol`. The backend flow becomes:

1. Upload placeholder metadata → `tempURI`
2. Deploy collection with `tempURI` → decode `paymentSplitter` from `CollectionCreated` event
3. Re-upload metadata with `fee_recipient = paymentSplitter` → `finalURI`
4. Call `NFTCollection.setContractURI(finalURI)`

This also unlocks future metadata edits (cover image, description, banner) without redeploying the collection. Requires redeploying the `ATTRDeployer` factory.

### 2. `separate` payment model — "base cost + tip" support

**Current behaviour:** The `separate` payment model (see `mint.paymentModel` in `collection.model.ts`) currently mirrors `royaltyCreators` into `mintCreators`, so it behaves like `unified` for the mint side.

**Intended behaviour:** The mint primary (gallery / deployer) should receive the base `mint.cost`, while creators split any additional staked/tipped amount by share weight.

**Planned fix:** Requires contract changes to distinguish the base fee from the tip in the payment flow (e.g. `mint()` accepts `msg.value >= baseCost`, routes `baseCost` to the mint primary, routes `msg.value - baseCost` to the creators' PaymentSplitter). Until that lands, `separate` falls back to unified mint splits. Referenced by `TODO` in `src/services/factory.service.ts`.

### 3. Membership fee distributor for the liquidity flywheel

**Business model:** Membership NFT sales should become a recurring liquidity and holder-yield engine:

```text
Membership NFT Sale
        ↓
70% → Treasury operations
30% → ATTR/WETH LP capital
        ↓
LP position created
        ↓
LP fee accrual split:
50% → Treasury
50% → Membership NFT holders pro-rata
```

**Why this is attractive:** Every membership sale deepens ATTR liquidity without a manual treasury decision, Membership NFTs become productive assets, holders are aligned with future membership sales and deeper token liquidity, and rewards come from LP trading fees rather than inflation.

**Planned contract:** Add a fee distributor contract for Membership NFT holders. The contract should track Membership NFT ownership, receive accumulated LP fee proceeds, calculate pro-rata claimable rewards, and let holders claim their share. The first implementation can be equal-weighted per Membership NFT; a later tier-aware version can weight premium NFTs more heavily, e.g. Gold = 2x.

**Implementation notes:** LP capital created from the 30% membership-sale allocation should follow the same 50% LP lock posture described in `docs/deployment/ATTRTOKEN_MAINNET_DEPLOYMENT.md` under "LP Token Locking Explained" (UncX, 50% locked, 50% operationally flexible). The fee distributor should be designed so fee deposits and holder claims are auditable and do not require NFT holder iteration on-chain.

### 4. ATTR spender for collection mint payments

**Current behaviour:** Each deployed NFT collection that accepts ATTR payments needs its own token approval path. That means users may need to approve ATTR spending separately for every collection contract they interact with.

**Planned contract:** Add a shared `ATTRSpender` contract that NFT collections can delegate to for ATTR payment collection. Users approve ATTR once to the spender, and collections route ATTR payment pulls through that shared spender.

**Why this matters:** This streamlines the approve call flow, reduces repeated user approvals across newly deployed collections, and gives the protocol one narrow place to reason about ATTR transfer permissions. The spender should only allow authorized collection contracts to initiate pulls, should enforce recipient/amount data passed by the collection, and should emit clear payment events for indexing and reconciliation.
