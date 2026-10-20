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
| `test` | `compile`, `build`, `check:package`, `test:contracts`, `lint:sol` | **Yes** (each step) |
| `test` (coverage) | `coverage` + Codecov upload | No — informational only (see below) |
| `slither` | Slither against `slither.config.json`, then the baseline gate | **Yes** (new findings only) |
| `gas-snapshot` (PRs into `main` only) | Foundry `ci` smoke suite; excludes `invariant_SumOfBalancesEqualsSupply` | **Yes** (suite health) |
| `gas-snapshot` (gas comparison) | `gas:check`, reported in job summary and log | No — report-only |

Foundry already runs in the `gas-snapshot` job on PRs into `main`, using
`FOUNDRY_PROFILE=ci`: 256 fuzz runs and 256 invariant runs at depth 32.
The named balance-sum invariant remains excluded by deliberate policy (see
*Invariant scope and compute policy* below). Deep 10,000-run testing stays local;
it must not be added to GitHub CI.

CI (and repo development) is pinned to **Node 22** via `devEngines.runtime`
(`>=22.13.0`), `.nvmrc`, and the workflow `node-version` — Hardhat v3 refuses to
run on Node 20 (`Please upgrade to Node.js 22.13.0 or later`), so the earlier 20
pin broke `npm run compile` in CI. CI never auto-fixes or commits; gates fail
loudly.

This is a **dev-only** requirement: the published `engines.node` is relaxed to
`>=18.20.0` because the runtime surface (`dist/src/index.js`) is plain ESM that
needs neither Hardhat nor Node 22. See the README's *Runtime requirement* table.

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
FOUNDRY_PROFILE=ci npm run test:fuzz -- --no-match-test invariant_SumOfBalancesEqualsSupply
# Same scoped Foundry smoke suite as PR CI (requires forge)

npm run test:fuzz   # LOCAL ONLY: full deep suite, 10,000 runs / invariant depth 256
```

Run `npm run gate` before opening a PR. A red gate at review is an author
process failure, not a QA fix-up.

### Self-contained package build and release checks

Run `npm run compile && npm run build` to prepare the package. `build` removes
`dist/` and then runs `tsc -p tsconfig.build.json`. Because `tsconfig.json` sets
`resolveJsonModule: true` (and `rootDir` is the repo root), `tsc` emits the
imported `artifacts/contracts/**/*.json` into `dist/artifacts/contracts/`
alongside the compiled JS — no separate copy step is needed. The relative
imports from `dist/src/index.js` therefore resolve without a local Hardhat
checkout, and removing `dist/` first means stale TypeChain files cannot survive.

> An earlier `postbuild` hook (`scripts/util/copy-artifacts.js`) mirrored the
> same JSONs into `dist/artifacts/` and claimed `tsc` does not copy JSON. That
> claim is false for this config (`resolveJsonModule: true`); the hook was
> redundant with `tsc` output and has been removed. The real fail-closed
> guarantee is `check:package`, below.

Both PR CI and [the publish workflow](../../.github/workflows/publish.yml) run
`npm run check:package`: require the artifact directory, retain
`npm pack --dry-run`, assert the real tarball contains all 10 contract JSONs and
zero TypeChain files, then install it in a temporary consumer directory and
import `attr-web3`, checking all 10 ABI and bytecode exports. The check does not
publish anything and disables dependency install scripts. `check:package` is the
real fail-closed guarantee that the published tarball is complete and importable.

Publishing remains a separate, explicitly authorized release: tag/dispatch
version must equal `package.json`, manual `dry_run` defaults to true, and actual
publishing uses provenance with the `NPM_TOKEN` secret. These package checks
do not bump versions or push release tags. To roll back this build/CI change,
revert its commit through a PR; do not publish from the previous incomplete
workflow.

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

The scripts retain `--no-match-test invariant_SumOfBalancesEqualsSupply`,
matching the intentionally scoped CI suite. This is not evidence of a remaining
handler defect; see *Invariant scope and compute policy* below.

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

## Invariant scope and compute policy

**Decision (Daniel, 2026-10-20; issue #4):** keep the existing CI and gas-script
exclusion of `invariant_SumOfBalancesEqualsSupply`. Keep deep fuzz/invariant
runs local. Restoring this invariant to CI is not an outstanding acceptance
criterion and no larger CI budget is authorized by this documentation change.

The old accounting-harness defect was resolved in
[PR #16](https://github.com/SaluteDan/attr-web3-main/pull/16), merge
`74005dcfb120e6371200e822819e7fd6c84fb0b4`:

- `test/fuzz/ATTRToken.fuzz.t.sol` targets the test contract, selecting only
  `handler_transfer` and `handler_burn`, rather than driving `ATTRToken` directly.
- Transfers choose both endpoints from `[treasury, alice, bob, owner]`, the same
  four holders summed by the invariant. The entire initial supply is in treasury.
- Burns are bounded by the selected address's balance and reduce supply along
  with balances; they cannot move tokens to an untracked holder.

The prior claim that this invariant still fails because unrestricted token
transfers escape a five-holder sum is obsolete. This is a structural explanation
of the merged fix, not a claim of new fuzz-run results.

| Scope | Fuzz runs | Invariant runs / depth | Location |
| --- | --- | --- | --- |
| `ci` profile, named invariant excluded | 256 | 256 / 32 | GitHub PR smoke suite |
| `default` profile, full suite | 10,000 | 10,000 / 256 | Local only |

The local deep run can be lengthy (Daniel reported about nine hours for the
last 10k run). Do not restore the excluded invariant or raise CI run counts as
routine issue cleanup. Any future CI expansion needs a separate measured-runtime
proposal and approval.

### Separate documentation debt

`docs/test/TESTING_STRATEGY.md` still contains historical Ethers.js/Chai examples
and removed token-role APIs; the live stack is viem + Hardhat v3
(`@nomicfoundation/hardhat-node-test-runner`). Its CI summary is corrected here,
but a full examples rewrite is separate work, not an unresolved invariant bug.
