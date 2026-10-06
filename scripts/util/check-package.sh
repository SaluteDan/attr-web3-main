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
assert.equal(artifacts.length, 10, "Expected all 10 public contract artifacts");
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
];
for (const name of contracts) {
  assert.ok(Array.isArray(pkg[`${name}ABI`]) && pkg[`${name}ABI`].length > 0, `${name} ABI`);
  assert.match(pkg[`${name}Bytecode`], /^0x[0-9a-fA-F]+$/, `${name} bytecode`);
}
console.log("Clean-room attr-web3 import: all 10 ABIs and bytecodes resolve.");
NODE
