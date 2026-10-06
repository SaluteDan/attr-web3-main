# Smart Contract Mainnet Readiness Report

**Date:** October 2, 2026 (refreshed)
**Supersedes:** April 17, 2026 review (legacy scope and 128-test count, both now outdated)
**Review Scope:** ATTRDeployer, ATTRSpender, ATTRToken, NFTCollection, PaymentSplitter, MembershipToken, MembershipSaleSplitter, MembershipFeeDistributor, VestingLockCampaign, VestingLockCampaignFactory
**Test Results:** 253/253 passing ✅
**Overall Status:** **READY FOR MAINNET** ✅ (subject to the go-live checklist below)

---

## Executive Summary

All reviewed contracts are **READY FOR MAINNET DEPLOYMENT**:

- ✅ **253/253 tests passing** (re-run against current `main`-derived code, 2026-10-02)
- ✅ Test suite executed via the **fixed `test:contracts` script** (`hardhat test`, honours `paths.tests = ./test/contracts`) — no longer a literal shell glob
- ✅ Enhanced PaymentSplitter with automation features
- ✅ Additive royalty logic in ATTRDeployer
- ✅ Comprehensive access control implemented
- ✅ Pause mechanisms in place for emergency stops
- ✅ OpenZeppelin battle-tested implementations
- ✅ **MembershipToken consolidates the membership + governance NFT surface** — all previous MembershipToken deferrals are resolved (see §6)

**Governance note:** The legacy governance NFT has been **removed from the codebase and superseded by `MembershipToken`** (tiered membership NFT, ERC721Votes + ERC2981). No legacy governance NFT contract is deployed, imported, or reviewed. Any legacy document still referencing it is out of date.

---

## Test Evidence (2026-10-02)

**Command (fixed script):**

```bash
npm run test:contracts      # → "hardhat test" (paths.tests = ./test/contracts)
```

**Result:**

```
253 passing (253 nodejs)
EXIT=0
```

**Per-suite breakdown (from the run):**

| Suite | Tests | Status |
|-------|-------|--------|
| MembershipToken | 52 | ✅ Passing |
| NFTCollection | 47 | ✅ Passing |
| PaymentSplitter | 42 | ✅ Passing |
| MembershipFeeDistributor | 28 | ✅ Passing |
| ATTRDeployer | 26 | ✅ Passing |
| ATTRToken | 24 | ✅ Passing |
| ATTRSpender | 16 | ✅ Passing |
| MembershipSaleSplitter | 9 | ✅ Passing |
| VestingLockCampaign | 8 | ✅ Passing |
| VestingLockCampaignFactory | 1 | ✅ Passing |
| **Total** | **253** | **✅ All Passing** |

> The prior `test:contracts` value (`hardhat test test/contracts/**/*.test.ts`) passed a literal glob that Node's ESM test runner could not resolve. It now runs `hardhat test`, which uses the configured `paths.tests`. The one-line script fix is included on this `docs/readiness-refresh` branch.

---

## Contract Analysis

### 1. ATTRDeployer.sol ✅ READY

**Role:** Factory that lets the owner (backend) deploy NFT collections.

**Features:**
- ✅ PaymentSplitter address storage (`collectionToSplitter` mapping) and deployed-splitter tracking
- ✅ Getter functions for PaymentSplitter retrieval
- ✅ `CollectionCreated` event carries the PaymentSplitter address
- ✅ **Additive royalty logic** (platform fee is additive to artist royalty)

**Security Analysis:**
- ✅ Proper access control via `Ownable`
- ✅ Validation on all inputs (royalty ≤ 100%, non-zero addresses, total royalty ≤ 100%)
- ✅ No reentrancy vulnerabilities
- ✅ Safe contract-deployment patterns

**Architecture:**
- ✅ Automatic PaymentSplitter deployment when platform fee > 0; direct-to-artist otherwise
- ✅ Correct royalty calculation passed to NFTCollection
- ✅ PaymentSplitter addresses permanently tracked

**Test Coverage:** 26/26 passing ✅

**Recommendations:** Ready for mainnet. Consider an upgradeability path only if future requirements demand it.

---

### 2. ATTRSpender.sol ✅ READY

**Role:** Shared ATTR-token payment proxy for all factory-deployed NFT collections. Users approve ATTR **once**; authorised collections call `collectPayment` to pull base + tip and route to separate receivers.

**Security Analysis:**
- ✅ Narrow approval surface: one allowance, one spender
- ✅ Only owner (ATTRDeployer) may authorise/revoke collections
- ✅ SafeERC20 transfer patterns; explicit receiver routing
- ✅ No reentrancy vulnerabilities

**Test Coverage:** 16/16 passing ✅

**Recommendations:** Ready for mainnet. Keep the authorisation surface minimal post-launch.

---

### 3. ATTRToken.sol ✅ READY

**Role:** "$ATTR" — native platform token.

**Features:**
- ✅ ERC20 + ERC20Burnable
- ✅ ERC20Capped (hard cap)
- ✅ ERC20Permit (gasless approvals)
- ✅ ERC20Votes (governance capabilities)
- ✅ AccessControl (role-based permissions: `MINTER_ROLE`, `DEFAULT_ADMIN_ROLE`)
- ✅ Pausable

**Security Analysis:**
- ✅ Hard cap on total supply
- ✅ Role-based access control
- ✅ Proper overrides of conflicting inherited functions
- ✅ No reentrancy vulnerabilities
- ✅ Pause mechanism for emergency stops

**Test Coverage:** 24/24 passing ✅

**Recommendations:** Ready for mainnet. Consider a time-lock for role changes in production.

---

### 4. NFTCollection.sol ✅ READY

**Role:** ERC-721 collection with dynamic metadata, deployed by ATTRDeployer.

**Features:**
- ✅ ERC721 + ERC721URIStorage
- ✅ ERC2981 royalties
- ✅ EIP-712 signature verification for vouchers
- ✅ ERC20Permit for gasless approvals
- ✅ Pausable; max-supply and max-mint-per-wallet enforcement
- ✅ SafeERC20 for token transfers

**Security Analysis:**
- ✅ Nonce tracking prevents replay attacks
- ✅ EIP-712 signature verification
- ✅ Proper `Ownable` access control and pause mechanism
- ✅ SafeERC20 for all token operations
- ✅ No reentrancy vulnerabilities; proper input validation

**Payment Handling:**
- ✅ ETH payments forwarded to `paymentReceiver`
- ✅ ERC20 payments with Permit or pre-approval; safe transfer patterns

**Known Issue (previously accepted):**
- ⚠️ `redeemWithApproval()` transfers from `voucher.recipient` rather than `msg.sender`
  - **Impact:** Low — intentional for the ERC-4337 / Smart Account flow.
  - **Status:** Acceptable for current use case.

**Test Coverage:** 47/47 passing ✅

**Recommendations:** Ready for mainnet. Consider ReentrancyGuard hardening for future-proofing.

---

### 5. PaymentSplitter.sol ✅ READY

**Role:** Splits ETH/ERC20 among payees by shares (pull-payment model), with automation helpers.

**Recent Enhancements:**
- ✅ Batch release (`releaseAll()` for ETH and ERC20)
- ✅ Payee management (`addPayee()`, `updatePayeeShares()`)
- ✅ Automation-friendly view functions (`totalPendingPayments()`, `getPayeesWithPendingPayments()`)
- ✅ Access control via `Ownable`; events for tracking

**Security Analysis:**
- ✅ OpenZeppelin `SafeERC20` for token transfers
- ✅ OpenZeppelin `Address.sendValue` / low-level call for ETH transfers
- ✅ No reentrancy vulnerabilities (pull-payment model)
- ✅ Access control on management functions
- ✅ No external calls before state updates

**Gas Optimization:**
- ✅ Assembly used for array resizing; efficient loops; minimal storage writes

**Test Coverage:** 42/42 passing ✅

**Recommendations:** Ready for mainnet. ReentrancyGuard optional (pull model already safe).

---

### 6. MembershipToken.sol ✅ READY (previously deferred items now resolved)

**Role:** "ATTR-MEMBER-ID" — tiered membership NFT with on-chain voting power (ERC721Votes) and ERC2981 royalties. **Consolidates the former governance/membership NFT surface.** Token IDs start at 0; public mint via `mintMembership`, admin mint via `adminMintMembership` / `adminBatchMintMemberships`.

**Features:**
- ✅ ERC721URIStorage + ERC721Votes + ERC2981 + EIP712
- ✅ ReentrancyGuard + Pausable
- ✅ Immutable `MAX_SUPPLY` and `MAX_MINT_PER_WALLET`
- ✅ Tier pricing (`tierPrices`, `setTierPrice`), per-token tier tracking
- ✅ Collection-level `contractURI`
- ✅ Configurable `paymentReceiver`; `receive()` rejects direct ETH

**Re-verification of previously deferred audit items (against current code):**

| # | Previous finding | Severity | Current status | Evidence |
|---|------------------|----------|----------------|----------|
| 1 | **Reentrancy in `withdrawPayments()`** | HIGH | ✅ **RESOLVED** | `withdrawPayments()` is `external onlyOwner nonReentrant`; reads balance, reverts on zero, then single external call. Guarded against re-entry. |
| 2 | **Funds not forwarded on mint (accumulate in contract)** | HIGH | ✅ **RESOLVED** | `mintMembership()` is `payable nonReentrant whenNotPaused` and **forwards `msg.value` to `paymentReceiver` immediately**. State (`_nextTokenId`, `_mintedCounts`) is incremented **before** the external call (CEI order). |
| 3 | **No max supply cap** | MEDIUM | ✅ **RESOLVED** | Immutable `MAX_SUPPLY`; `mintMembership`/`adminMintMembership`/`adminBatchMintMemberships` all revert with `MaxSupplyExceeded` at the cap. `MAX_MINT_PER_WALLET` caps the public sale per wallet. |

**Additional hardening observed:**
- ✅ `mintMembership` validates `msg.value >= tierPrices[tier]` and reverts `InsufficientPayment`; overpayment is forwarded, not retained.
- ✅ `withdrawPayments()` reverts `NothingToClaim` on zero balance (emergency flush only — normal payments never accumulate).
- ✅ `receive()` reverts `TransferFailed`, so ETH cannot be stranded by direct sends.
- ✅ Multi-inheritance overrides for `_update`, `_increaseBalance`, `tokenURI`, `supportsInterface` are correct.

**Residual note:** `_safeMint` runs after the ETH forward; reentrancy is covered by `nonReentrant` (the ERC-721 receiver callback cannot re-enter the guarded functions). No open HIGH/MEDIUM items.

**Test Coverage:** 52/52 passing ✅

**Recommendations:** Ready for mainnet. If desired, an operational time-lock on `setPaymentReceiver`/`setTierPrice` can be added post-launch.

---

### 7. MembershipSaleSplitter.sol ✅ READY

**Role:** Immutable 70/30 ETH splitter for membership sale proceeds — 70% to `treasuryOps`, 30% to `liquidityReceiver` (ATTR/WETH LP seeding).

**Security Analysis:**
- ✅ No owner and no mutable state — split enforced by constructor args, immutable thereafter
- ✅ Forwards on receipt; cannot be repointed

**Test Coverage:** 9/9 passing ✅

**Integration:** Point `MembershipToken.paymentReceiver` at this contract to automate the split.

**Recommendations:** Ready for mainnet.

---

### 8. MembershipFeeDistributor.sol ✅ READY

**Role:** Distributes ETH and ERC20 LP-fee proceeds **equally per MembershipToken token-ID** without iterating all holders on-chain (Synthetix-style cumulative reward index).

**Security Analysis:**
- ✅ O(1) claim accounting; no unbounded loops
- ✅ Per-token last-claimed index prevents double claims
- ✅ SafeERC20 for token deposits/payouts

**Test Coverage:** 28/28 passing ✅

**Recommendations:** Ready for mainnet. Monitor index updates and claim events.

---

### 9. VestingLockCampaign.sol ✅ READY

**Role:** Reusable lock-to-earn campaign for ATTR vesting/retention — users lock `stakingToken` for `lockPeriod`; rewards paid from a prefunded `rewardToken` balance. Includes `claimRewardAndWithdraw`.

**Security Analysis:**
- ✅ Prefunded reward accounting; per-user lock state
- ✅ SafeERC20 patterns

**Test Coverage:** 8/8 passing ✅

**Recommendations:** Ready for mainnet.

---

### 10. VestingLockCampaignFactory.sol ✅ READY

**Role:** Deploys isolated VestingLockCampaign instances with per-campaign funding and state.

**Test Coverage:** 1/1 passing ✅

**Recommendations:** Ready for mainnet.

---

## Mainnet Deployment Checklist

### Pre-Deployment
- ✅ All contracts compiled successfully
- ✅ All tests passing (253/253) via the fixed `test:contracts` script
- ✅ Code reviewed for security issues
- ✅ Gas optimization verified
- ✅ Access control patterns validated
- ✅ Pause mechanisms in place
- ✅ MembershipToken deferrals re-verified and resolved

### Deployment Process
1. Deploy `ATTRToken` (capped, roles, pausable)
2. Deploy `ATTRDeployer` with the backend wallet as owner
3. Deploy `ATTRSpender` and authorise it in `ATTRDeployer`
4. Deploy `MembershipToken` (owner = backend wallet) and point `paymentReceiver` at `MembershipSaleSplitter`
5. Deploy `MembershipSaleSplitter` (70/30) and `MembershipFeeDistributor`
6. Deploy `VestingLockCampaignFactory`
7. Deploy PaymentSplitter/NFTCollection instances via `ATTRDeployer`
8. Verify all contracts on Basescan
9. Set up monitoring for PaymentSplitter / distributor activity

### Post-Deployment
- Set up a CRON job for royalty/fee distribution
- Monitor PaymentSplitter and MembershipFeeDistributor balances
- Alerts for unusual activity; test the pause mechanism in production
- Monitor gas costs and optimise if needed

---

## Royalty / Fee Distribution Automation

**Service:** `RoyaltyDistributionService` (created)
**Frequency:** Daily or hourly (configurable)
**Threshold:** 0.01 ETH minimum for distribution

```typescript
import royaltyDistributionService from './services/royalty-distribution.service';

cron.schedule('0 0 * * *', async () => {
  await royaltyDistributionService.distributeAllRoyalties(
    BigInt("10000000000000000") // 0.01 ETH threshold
  );
});
```

**Monitoring:** track splitter/distributor balances, distribution success/failure, stuck funds, and gas costs.

---

## Security Recommendations

### High Priority (Before Mainnet)
- ✅ All high-priority issues addressed — including the previously deferred MembershipToken reentrancy and fund-forwarding items (now resolved)

### Medium Priority (Post-Launch)
- Consider adding ReentrancyGuard to the remaining contracts (pull-payment splitter already safe)
- Implement a time-lock for critical role/receiver changes
- Use a multi-sig for the factory owner
- Evaluate upgradeability patterns only if requirements demand them

### Low Priority (Future Enhancements)
- Gas-cost monitoring
- Circuit breakers for unusual activity
- Consider EIP-2535 (Diamond) only if contract complexity grows

---

## Gas Analysis

### Estimated Deployment Costs
- ATTRDeployer: ~1,500,000 gas
- PaymentSplitter: ~800,000 gas
- NFTCollection: ~2,000,000 gas
- ATTRToken: ~1,200,000 gas
- MembershipToken: ~2,400,000 gas

### Gas Optimization Status
- ✅ Optimizer enabled (200 runs)
- ✅ Efficient storage patterns
- ✅ Minimal external calls
- ✅ Assembly optimizations where appropriate

---

## Conclusion

**STATUS: READY FOR MAINNET DEPLOYMENT** ✅

The reviewed contracts (ATTRDeployer, ATTRSpender, ATTRToken, NFTCollection, PaymentSplitter, MembershipToken, MembershipSaleSplitter, MembershipFeeDistributor, VestingLockCampaign, VestingLockCampaignFactory) are **production-ready** with:
- ✅ Comprehensive test coverage (253/253 passing, verified 2026-10-02)
- ✅ Enhanced PaymentSplitter with automation features
- ✅ Additive royalty logic
- ✅ Proper access control and security measures
- ✅ Pause mechanisms for emergency stops
- ✅ MembershipToken resolves all previously deferred membership-vesting items and consolidates governance voting
- ✅ OpenZeppelin battle-tested implementations

**Next Steps:**
1. Deploy to testnet for final validation
2. Set up monitoring and CRON jobs
3. Deploy to mainnet
4. Monitor and optimise post-launch

---

## Appendix: Contract Addresses

### Environment Variables Required
```bash
FACTORY_CONTRACT_ADDRESS=0x...           # ATTRDeployer address
PLATFORM_TREASURY_ADDRESS=0x...          # Platform treasury for fees
DEFAULT_PLATFORM_FEE_BPS=1000            # Default platform fee (optional)
MEMBERSHIP_TOKEN_CONTRACT=0x...          # MembershipToken address
```

### Key Contract Functions
```solidity
// ATTRDeployer
createCollection(...) → address
getPaymentSplitter(collectionAddress) → address
getDeployedSplitters() → address[]

// PaymentSplitter
releaseAll() → batch release ETH
releaseAll(token) → batch release ERC20
totalPendingPayments() → uint256
getPayeesWithPendingPayments() → address[]

// MembershipToken
mintMembership(tier, metadataURI) → uint256   // forwards msg.value to paymentReceiver
adminMintMembership(to, tier, metadataURI) → uint256
adminBatchMintMemberships(recipients, tiers, metadataURIs)
withdrawPayments()                             // emergency flush, nonReentrant
```

---

**Report Generated:** October 2, 2026
**Reviewed By:** ATTR contracts team (readiness refresh)
**Branch:** `docs/readiness-refresh`
