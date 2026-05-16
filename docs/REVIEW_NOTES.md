# Code Review Notes

Follow-ups from the review of the current working changes.

## Requires manual action

- **`.env.production` FRONTEND_URL uses `http://`** — gitignored, so not editable by tooling. Revert to `https://base.attributes.gallery` before deploying. Plain HTTP in production is a security regression (MITM, cookie leakage, mixed-content issues).

## Reconsidered (no change)

- **Gas limit on ETH forward in `MembershipToken.mintMembership`** — the initial suggestion to cap gas at 5000 was wrong. `paymentReceiver` may legitimately be a contract (e.g. a `PaymentSplitter` or multisig) that needs more than 2300/5000 gas to accept ETH. Current behavior (forward full gas with `.call`) is correct; receiver is owner-controlled and therefore trusted.
- **Factory address validation in `factory.service.ts`** — already guarded at every public method (`deployCollection`, `getDeployedCollections`, `getPaymentSplitter`, `getDeployedSplitters`). The startup `console.warn` is acceptable.

## Low priority / deferred

- **Assembly array resize in `PaymentSplitter.getPayeesWithPendingPayments`** (`mstore(pending, count)`) — standard pattern but bypasses Solidity's safety. Acceptable given payees array is bounded and owner-controlled. Worth covering with a unit test that asserts correct length after filtering.
- **Unused import in `src/models/collection.model.ts`**: `import { isStringObject } from "util/types";` — harmless, clean up next pass.
- **Factory address rotation in `.env`** (`0x2453…aC63` → `0x730A…5cf3`) — verify the new factory is deployed, verified on Basescan, and that the backend key has owner privileges on it before going live.
- **`MembershipToken.withdrawPayments` is now effectively dead code** since `mintMembership` forwards immediately and `receive()` reverts. Keep as a safety net, or remove in a later cleanup.

## Fixed in this pass

- `ATTRDeployer.createCollection`: `mintPaymentReceiver` now only routes to `platformTreasury` when `platformFeeBps > 0`.
- `MembershipToken.receive()`: now reverts on direct ETH transfers.
- `factory.service.deployCollection`: throws instead of warning when platform fee is set without a treasury address.
