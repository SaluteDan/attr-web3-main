# Slither baseline triage — 2026-10-19

Context: the Slither gate (`node scripts/util/slither-baseline.js`) had been failing
on `main` since 2026-10-17 with `53 findings / 30 baselined / 28 NEW`. The baseline
was written on 2026-10-05 and never refreshed after four feature PRs, so it
described an older codebase.

**This is not a rubber stamp.** Every finding below was reviewed individually. Four
were fixed in code. The 24 accepted findings are recorded here with the reason, and
`slither.baseline.json` was refreshed only after that review.

Refresh command: `node scripts/util/slither-baseline.js --write` (now 49 entries).

---

## Fixed in code (4)

| # | Check | Location | Fix |
| --- | --- | --- | --- |
| 1 | `missing-zero-check` (Low) | `ATTROnboardingVault.constructor` | Reject `membershipToken_ == address(0)` — previously only `attrToken_` and `daoTimelock_` were checked. |
| 2 | `missing-zero-check` (Low) | `MembershipToken.setFeeDistributor` | Reject a zero distributor; a zero address would silently disable checkpoints. |
| 3 | `missing-zero-check` (Low) | `MembershipFeeDistributor.setKeeper` | Reject a zero keeper; a zero keeper silently disables keeper-gated pushes. |
| 4 | `missing-inheritance` (Informational) | `MembershipToken` | Declare `IMembershipTiers` and import it. `totalSupply()` widened `external` → `public` to satisfy the interface. Behaviour unchanged. |

All 264 Hardhat tests pass after these changes.

---

## Accepted (24) — with reason

### False positives — the detector misread the code (7)

| Check | Location | Why it is wrong |
| --- | --- | --- |
| `weak-prng` (High) ×2 | `depositETH`, `depositERC20` | `distributable % W` is an integer dust remainder, not a randomness source. No value depends on unpredictability. Already annotated `divide-before-multiply`; the `weak-prng` label is a misclassification of a legitimate modulo. |
| `uninitialized-local` (Medium) ×4 | `_freezeBasis.sum`, `checkpoint.totalSettled`, `claimPendingERC20.empty`, `claimPendingETH.empty` | All are accumulators (`sum +=`, `totalSettled +=`) or declared-then-written array arguments. Solidity zero-initialises locals; every one is assigned before use. |
| `arbitrary-send-eth` (High) | `_push` | Pays a **recorded** `pendingClaims[t][holder]` entry to that holder. This is a pull-payment, not an arbitrary send: the amount and recipient both come from settled state, the entry is zeroed before transfer (CEI), and `nonReentrant` guards it. |

### By design — inherent to the mechanism (11)

| Check | Location | Why accepted |
| --- | --- | --- |
| `calls-loop` (Low) ×6 | `_weightOf` (×3 via `_liveWeight`), `claimERC20`, `claimETH`, `MembershipToken._update` | Reading `getTier`/`ownerOf` per token id is the mechanism: weights must be read live from the membership contract so a tier change cannot be caller-supplied. Bounded by extant supply on owner-only deposits, and by the caller's own `tokenIds` array on claims. |
| `timestamp` (Low) ×5 | `_accruedAt`, `_closeInterval`, `_peek`, `_settleTo`, `MembershipToken.executeTierPrice` | Interval accrual is defined in wall-clock time. The comparisons are the intended semantics (window boundaries, notice periods), not reliance on miner-manipulable values for randomness or ordering. |

### Accepted — real but not worth changing now (6)

| Check | Location | Why accepted |
| --- | --- | --- |
| `incorrect-equality` (Medium) | `depositERC20` | `received == 0` is a deliberate zero-deposit guard for fee-on-transfer tokens. Strict equality on a zero check is correct here. |
| `low-level-calls` (Informational) ×4 | `_push`, `claimETH`, `claimPendingETH`, `mintMembership` | ETH forwarding requires `call`; each is wrapped with an explicit success check that reverts `TransferFailed`. |
| `dead-code` (Informational) | `_clampedWeight` | Genuinely unused — `_freezeBasis` superseded it. **Kept deliberately** pending a decision: its docstring claims to defend against a forged tier read (S3), and that defence now lives in the frozen basis (`Σ frozen weights == intervalWeight`). Deleting it is a one-line change, but removing a security-named helper is worth a reviewer's eye rather than a silent prune. Flagged for QA. |

---

## Not fixed, deliberately

`_clampedWeight` (dead code) is the only item where the "right" action is a judgement
call rather than mechanical. Everything else is either fixed or a documented
false-positive/by-design acceptance.

## Verification

```
node scripts/util/slither-baseline.js
[slither-baseline] 49 finding(s) in report, 49 in baseline
[slither-baseline] no new findings — OK
```

VestingLockCampaign entries in the baseline stayed at **4 before and 4 after** — this
refresh did not hide any new finding in the recently merged vesting work.
