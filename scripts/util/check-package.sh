#!/usr/bin/env bash
set -euo pipefail

# Fail closed on missing artifacts, stale TypeChain files, or unusable exports.
# Pack/install happens outside the checkout to avoid resolving local sources.
test -d dist/artifacts/contracts
npm pack --dry-run
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
npm pack --json --pack-destination "$TEMP_DIR" > "$TEMP_DIR/pack.json"
node --input-type=module - "$TEMP_DIR/pack.json" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const [pack] = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(pack.files.filter(({ path }) => /typechain/i.test(path)).length, 0);
const artifacts = pack.files.filter(({ path }) =>
  path.startsWith("dist/artifacts/contracts/") && path.endsWith(".json"),
);
// Assert the exact artifact SET rather than a count: a count silently rots when a
// contract is added (it did — PR #16 added ATTROnboardingVault and this gate has
// been red since), and it also passes if an unrelated artifact replaces a real
// one. The interface artifact is included deliberately: it ships and carries an
// ABI, even though it has no bytecode of its own.
const EXPECTED_ARTIFACTS = [
  "dist/artifacts/contracts/ATTRDeployer.sol/ATTRDeployer.json",
  "dist/artifacts/contracts/ATTROnboardingVault.sol/ATTROnboardingVault.json",
  "dist/artifacts/contracts/ATTRSpender.sol/ATTRSpender.json",
  "dist/artifacts/contracts/ATTRToken.sol/ATTRToken.json",
  "dist/artifacts/contracts/MembershipFeeDistributor.sol/MembershipFeeDistributor.json",
  "dist/artifacts/contracts/MembershipSaleSplitter.sol/MembershipSaleSplitter.json",
  "dist/artifacts/contracts/MembershipToken.sol/MembershipToken.json",
  "dist/artifacts/contracts/NFTCollection.sol/NFTCollection.json",
  "dist/artifacts/contracts/PaymentSplitter.sol/PaymentSplitter.json",
  "dist/artifacts/contracts/VestingLockCampaign.sol/VestingLockCampaign.json",
  "dist/artifacts/contracts/VestingLockCampaignFactory.sol/VestingLockCampaignFactory.json",
  "dist/artifacts/contracts/interfaces/IATTROnboardingVault.sol/IATTROnboardingVault.json",
];
const shipped = artifacts.map(({ path }) => path).sort();
assert.deepEqual(
  shipped,
  [...EXPECTED_ARTIFACTS].sort(),
  `Tarball contract artifacts do not match the expected set.\n  unexpected: ${shipped.filter((p) => !EXPECTED_ARTIFACTS.includes(p)).join(", ") || "none"}\n  missing:    ${EXPECTED_ARTIFACTS.filter((p) => !shipped.includes(p)).join(", ") || "none"}`,
);
console.log(`Tarball: ${pack.entryCount} files; ${artifacts.length} contract JSONs; typechain=0.`);
NODE
TARBALL="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))[0].filename" "$TEMP_DIR/pack.json")"
mkdir "$TEMP_DIR/consumer"
cd "$TEMP_DIR/consumer"
printf '{"private":true,"type":"module"}\n' > package.json
npm install --ignore-scripts --legacy-peer-deps --no-audit --no-fund "$TEMP_DIR/$TARBALL"
node --input-type=module <<'NODE'
import assert from "node:assert/strict";
const pkg = await import("attr-web3");
const contracts = [
  "ATTRToken", "ATTRDeployer", "ATTRSpender", "NFTCollection",
  "MembershipToken", "MembershipSaleSplitter", "MembershipFeeDistributor",
  "PaymentSplitter", "VestingLockCampaign", "VestingLockCampaignFactory",
  "ATTROnboardingVault",
];
for (const name of contracts) {
  assert.ok(Array.isArray(pkg[`${name}ABI`]) && pkg[`${name}ABI`].length > 0, `${name} ABI`);
  assert.match(pkg[`${name}Bytecode`], /^0x[0-9a-fA-F]+$/, `${name} bytecode`);
}
// The interface ships an ABI but has no deployable bytecode ("0x" by definition),
// so it is asserted separately rather than through the bytecode check above.
assert.ok(
  Array.isArray(pkg.IATTROnboardingVaultABI) && pkg.IATTROnboardingVaultABI.length > 0,
  "IATTROnboardingVault ABI",
);
console.log(
  `Clean-room attr-web3 import: ${contracts.length} ABIs + bytecodes and 1 interface ABI resolve.`,
);
NODE
