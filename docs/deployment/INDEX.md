# Deployment Documentation Index

**Status:** historical — see `README.md` for the current contract table and
deploy order.
**Last reviewed:** 2026-10-03

> This folder holds **deployment-era records** (April 2026). Several are
> superseded by the current contracts and scripts. For anything you actually
> run, use the repo `README.md` and `scripts/deploy/` — not these pages.

## Current sources of truth

| Need | Use |
|---|---|
| Contract overview + descriptions | [`../../README.md`](../../README.md) |
| Deploy order + script mapping | [`../../README.md`](../../README.md#deployment-sequence) |
| Post-deploy wiring | [`../../README.md`](../../README.md#post-deployment-wiring) |
| Local architecture | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Commands | [`../../README.md`](../../README.md) · workspace `docs/REPO-MAP.md` |

## Files in this folder

| Document | Status | Notes |
|---|---|---|
| [`GUIDE.md`](./GUIDE.md) | ✏️ historical | Deployment walkthrough (Apr 2026); script paths/names have changed — cross-check `scripts/deploy/` |
| [`CHECKLIST.md`](./CHECKLIST.md) | ✏️ historical | Pre/during/post checklist; still useful as a template |
| [`SUMMARY.md`](./SUMMARY.md) | 📦 historical | Project snapshot (Apr 2026) |
| [`WORK_COMPLETED.md`](./WORK_COMPLETED.md) | 📦 historical | Work log (Apr 2026) |
| [`README.md`](./README.md) | 📦 historical | Deployment-era overview |
| [`MEMBERSHIP_TOKEN.md`](./MEMBERSHIP_TOKEN.md) | ✏️ historical | MembershipToken notes; verify against current contract (absorbed GovernanceNFT) |
| [`ATTRTOKEN_MAINNET.md`](./ATTRTOKEN_MAINNET.md) | ✏️ historical | ATTRToken mainnet notes; testnet-first policy applies |

## Removed references

Earlier versions of this index linked `DEPLOYMENT_README.md`,
`DEPLOYMENT_GUIDE.md`, `SECURITY_AUDIT.md`, `CRITICAL_FIXES.md`,
`DEPLOYMENT_CHECKLIST.md`, and `DEPLOYMENT_SUMMARY.md`. **Those files do not
exist** and the links were dead — corrected 2026-10-03.

## Related

- Test docs: [`../test/TESTING_STRATEGY.md`](../test/TESTING_STRATEGY.md),
  [`../test/INSTALL_FOUNDRY.md`](../test/INSTALL_FOUNDRY.md)
- Contract-level docs: [`../../contracts/docs/`](../../contracts/docs/)
