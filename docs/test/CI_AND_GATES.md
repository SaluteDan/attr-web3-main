# CI & Quality Gates

**Owner**: Smart Contract Team
**Applies to**: `attr-web3-main` (contracts repo)

The single source of truth for our CI is
[`.github/workflows/test.yml`](../../.github/workflows/test.yml). This document
explains what each gate enforces, how to run it locally, and how to maintain the
two committed baselines (Slither and gas).

---

## CI jobs

| Job | What it runs | Fails the build? |
| --- | --- | --- |
| `test` | `compile`, `test:contracts`, `lint:sol` | **Yes** (each step) |
| `test` (coverage) | `coverage` + Codecov upload | No — informational only (see below) |
| `slither` | Slither against `slither.config.json`, then the baseline gate | **Yes** (new findings only) |

Foundry fuzz/invariant tests are **not** a CI job yet — `forge test` is
currently non-deterministic (see *Known pre-existing issues*). Run it locally
with `npm run test:fuzz`.

Node is pinned to **22** (`engines.node >= 22.13.0`). Hardhat v3 refuses to run
on Node 20 (`Please upgrade to Node.js 22.13.0 or later`), so the earlier 20 pin
broke `npm run compile` in CI. CI never auto-fixes or commits; gates fail
loudly.

### Install: `legacy-peer-deps`

CI installs with `npm ci`. The committed `.npmrc` sets
`legacy-peer-deps=true` (as the frontend and backend repos do):
`solidity-coverage@0.8.17` declares a peerDependency on `hardhat@^2.11.0` while
this repo runs `hardhat@3.4.5`, which otherwise fails `npm ci` with `ERESOLVE`
before any gate runs. solidity-coverage is used only for the informational
coverage step (not a required gate), so ignoring its stale peer range is
intentional rather than silencing a real incompatibility.

### Local equivalent

```bash
npm run gate        # compile + test:contracts + lint:sol
npm run test:fuzz   # Foundry fuzz (requires forge)
```

Run `npm run gate` before opening a PR. A red gate at review is an author
process failure, not a QA fix-up.

---

## `test:contracts` must stay plain `hardhat test`

`test:contracts` is **`hardhat test`** with **no glob argument**. Hardhat v3's
node test runner receives the argument literally (the shell does not expand
`**`), so a path like `test/contracts/**/*.test.ts` is imported as a module and
fails with `ERR_MODULE_NOT_FOUND`. Hardhat already discovers tests via
`paths.tests` (`./test/contracts`) in `hardhat.config.ts`.

> Regression: PR #1. Do not reintroduce a glob here.

---

## Slither (static analysis) + baseline

Slither is wired via `slither.config.json` and runs in the `slither` CI job.
Slither exits `0` unless `--fail-*` flags are passed, so the gate is a small
script that compares the new report against a **committed baseline**:

- `slither.baseline.json` — accepted fingerprints (check + impact + contract +
  symbol + file). Line-number independent, so unrelated edits do not invalidate
  it.
- `scripts/util/slither-baseline.js` — writes the baseline (`--write`) or gates
  against it.

```bash
npm run slither                                   # writes slither-report.json
node scripts/util/slither-baseline.js             # gate: fail on NEW findings
node scripts/util/slither-baseline.js --write     # refresh after a review
```

Only **new** findings fail CI. Refreshing the baseline is a reviewed decision —
treat it like changing a test expectation. `slither-report.json` is generated
and git-ignored; the baseline is committed.

**Current state**: 30 baselined findings, all Low / Informational /
Optimization (e.g. `low-level-calls`, `immutable-states`, `calls-loop`) on the
payment/vesting paths. No High or Medium findings. Baseline these deliberately
rather than suppressing detectors globally.

---

## Gas snapshots

Foundry records per-test gas into `.gas-snapshot` (committed baseline).

```bash
npm run gas:snapshot   # regenerate .gas-snapshot
npm run gas:check      # exit non-zero if gas moved vs the committed baseline
npm run gas:diff       # print the deltas
```

The scripts pass `--no-match-test invariant_SumOfBalancesEqualsSupply` so the
baseline can be produced despite a pre-existing invalid invariant (see below).
Remove the exclusion once that test is fixed.

- **When** gas-sensitive paths change (payment routing, loop-bound logic,
  `ATTRDeployer` creation), run `gas:snapshot`, review the diff, and commit the
  updated `.gas-snapshot` in the same PR.
- `gas:check` is intentionally **not** a required CI gate (fuzz runs make exact
  values environment-sensitive); it is a local/pre-review signal, like
  `forge snapshot --check`.
- Keep it lightweight: do not add gas assertions to individual tests.

---

## Coverage: known limitation

`npm run coverage` (`hardhat test --coverage`) is run in CI for reporting, but
**does not gate** the build. solidity-coverage enables EIP-7825 under the current
hardhat default hardfork and caps the transaction gas at `2**24` (16 777 216).
Its own instrumentation inflates one `ATTRDeployer` / `PaymentSplitter` test
above that cap (`~19.98M`), so the instrumented run reports 252/253 with
`Test run failed` even though the uninstrumented suite passes 253/253.

The coverage step uses `continue-on-error: true` and the Codecov upload only
runs `if: hashFiles('coverage.json') != ''`, so a missing/failed coverage run
cannot fail the required gate. Revisit if solidity-coverage fixes the historical
EIP-7825 handling.

---

## Known pre-existing issues

These predate this CI work and block making Foundry a required gate; they are
recorded here so they are fixed deliberately rather than silently.

1. **Invalid / flaky invariant** — `test/fuzz/ATTRToken.fuzz.t.sol`
   `invariant_SumOfBalancesEqualsSupply()` sums a fixed set of five holders
   while the invariant fuzzer drives `ATTRToken` directly, so any transfer to an
   address outside that set makes the sum diverge from `totalSupply`. `forge
   test` fails non-deterministically because of it. Fix the invariant (or scope
   invariant fuzzing to a handler) before adding a `fuzz` CI job.
2. **Stale `docs/test/TESTING_STRATEGY.md`** references Ethers.js/Mocha and a
   removed `hardhat-toolbox`; the live stack is viem + Hardhat v3
   (`@nomicfoundation/hardhat-node-test-runner`). Out of scope here; tracked for
   a docs pass.
