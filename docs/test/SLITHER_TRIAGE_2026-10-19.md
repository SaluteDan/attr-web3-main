# Slither baseline triage — 2026-10-19

Context: the Slither gate (`node scripts/util/slither-baseline.js`) had been failing
on `main` since 2026-10-17 with `53 findings / 30 baselined / 28 NEW`. The baseline
was written on 2026-10-05 and never refreshed after four feature PRs, so it
described an older codebase.

**This is not a rubber stamp.** Every finding below was reviewed individually. Two
were fixed in code. Three were *initially* "fixed" and then deliberately reverted
after the Foundry suite proved the permissive behaviour was intentional — that
sequence is recorded below rather than hidden, because it is why those three are now
accepted.

Refresh command: `node scripts/util/slither-baseline.js --write` (now 51 entries).

---

## Fixed in code (2)

| # | Check | Location | Fix |
| --- | --- | --- | --- |
| 1 | `missing-inheritance` (Informational) | `MembershipToken` | Declare `IMembershipTiers` and import it. `totalSupply()` widened `external` -> `public` to satisfy the interface. Behaviour and ABI unchanged. |
| 2 | `dead-code` (Informational) | `MembershipFeeDistributor._clampedWeight` | Deleted. Unused since `_freezeBasis` superseded it. Before removing a security-named helper the S3 defence was re-verified as structural rather than incidental: `_freezeBasis` captures every extant token's weight at deposit so `Σ basisWeight == intervalWeight`, `_frozenWeight` returns `_basisWeight` directly, and `_accruedAt` divides by the frozen `intervalWeight` — so a per-token weight cannot exceed the denominator regardless of what the membership contract reports. The clamp was a redundant belt at a call site nothing called; the brace is the frozen basis. No behaviour or ABI change. |

---

## Reverted after review — the permissive behaviour is intentional (3)

These were first "fixed" by adding `ZeroAddress` guards. The Foundry suite then failed
two existing tests (`test_ConstructorAllowsZeroMembershipToken`,
`test_SetKeeperAndDustThreshold`) and the tests were right:

| Check | Location | Why zero must stay allowed |
| --- | --- | --- |
| `missing-zero-check` (Low) | `MembershipFeeDistributor.setKeeper` | `address(0)` is the documented **kill switch** for keeper-gated pushes, asserted by an existing test (`keeper cleared`). A guard would remove an operational capability. |
| `missing-zero-check` (Low) | `MembershipToken.setFeeDistributor` | `address(0)` intentionally **unbinds** the distributor and disables checkpoints. |
| `missing-zero-check` (Low) | `ATTROnboardingVault.constructor` | Binding `membershipToken` is deliberately **deferred**; the constructor accepts zero and `setMembershipToken` (which does enforce non-zero) binds it later. Asserted by an existing test. |

Guards were reverted and comments added at each site recording that zero is
deliberate. Any can still be tightened later, but only alongside a behaviour change
to the documented flows — not as a lint fix.

---

## Accepted (27) — with reason

### Detector false positives (7)

| Check | Location | Why it is wrong |
| --- | --- | --- |
| `weak-prng` (High) x2 | `depositETH`, `depositERC20` | `distributable % W` is an integer dust remainder, not a randomness source. No value depends on unpredictability. Already annotated `divide-before-multiply`; the `weak-prng` label is a misclassification of a legitimate modulo. |
| `uninitialized-local` (Medium) x4 | `_freezeBasis.sum`, `checkpoint.totalSettled`, `claimPendingERC20.empty`, `claimPendingETH.empty` | All are accumulators (`sum +=`, `totalSettled +=`) or declared-then-written array arguments. Solidity zero-initialises locals; every one is assigned before use. |
| `arbitrary-send-eth` (High) | `_push` | Pays a **recorded** `pendingClaims[t][holder]` entry to that holder. This is a pull-payment, not an arbitrary send: the amount and recipient both come from settled state, the entry is zeroed before transfer (CEI), and `nonReentrant` guards it. |

### By design — inherent to the mechanism (11)

| Check | Location | Why accepted |
| --- | --- | --- |
| `calls-loop` (Low) x6 | `_weightOf` (x3 via `_liveWeight`), `claimERC20`, `claimETH`, `MembershipToken._update` | Reading `getTier`/`ownerOf` per token id is the mechanism: weights must be read live from the membership contract so a tier change cannot be caller-supplied. Bounded by extant supply on owner-only deposits, and by the caller's own `tokenIds` array on claims. |
| `timestamp` (Low) x5 | `_accruedAt`, `_closeInterval`, `_peek`, `_settleTo`, `MembershipToken.executeTierPrice` | Interval accrual is defined in wall-clock time. The comparisons are the intended semantics (window boundaries, notice periods), not reliance on miner-manipulable values for randomness or ordering. |

### Accepted — real but not worth changing now (8)

| Check | Location | Why accepted |
| --- | --- | --- |
| `missing-zero-check` (Low) x3 | `setKeeper`, `setFeeDistributor`, `ATTROnboardingVault.constructor` | See "Reverted after review" above — zero is an intentional state in all three. |
| `incorrect-equality` (Medium) | `depositERC20` | `received == 0` is a deliberate zero-deposit guard for fee-on-transfer tokens. Strict equality on a zero check is correct here. |
| `low-level-calls` (Informational) x4 | `_push`, `claimETH`, `claimPendingETH`, `mintMembership` | ETH forwarding requires `call`; each is wrapped with an explicit success check that reverts `TransferFailed`. |

---

## Nothing left deferred

Every finding is now either fixed in code or accepted with a stated reason. The one
item previously deferred to a reviewer (`_clampedWeight`) was approved for removal by
Daniel and pruned, with the S3 defence re-verified as living in the frozen basis
before deletion rather than assumed.

## Verification

```
node scripts/util/slither-baseline.js
[slither-baseline] 51 finding(s) in report, 51 in baseline
[slither-baseline] no new findings — OK
```

VestingLockCampaign entries in the baseline stayed at **4 before and 4 after** — this
refresh did not hide any new finding in the recently merged vesting work.
