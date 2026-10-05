import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copyArtifacts } from "../../scripts/util/copy-artifacts.js";

test("mirrors nested contract JSON without build metadata", (t) => {
  const root = mkdtempSync(join(tmpdir(), "attr-artifacts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "artifacts/contracts");
  const target = join(root, "dist/artifacts/contracts");
  mkdirSync(join(source, "nested/Token.sol"), { recursive: true });
  mkdirSync(join(source, "Errors.sol"));
  writeFileSync(join(source, "nested/Token.sol/Token.json"), '{"abi":[]}');
  writeFileSync(join(source, "nested/Token.sol/Token.ts"), "not an artifact");

  assert.equal(copyArtifacts(source, target), 1);
  assert.equal(
    readFileSync(join(target, "nested/Token.sol/Token.json"), "utf8"),
    '{"abi":[]}',
  );
  assert.throws(() => readFileSync(join(target, "nested/Token.sol/Token.ts")));
});

test("fails closed when artifacts are missing or empty", (t) => {
  const root = mkdtempSync(join(tmpdir(), "attr-artifacts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "artifacts/contracts");
  const target = join(root, "dist/artifacts/contracts");
  assert.throws(() => copyArtifacts(source, target), /ENOENT/);
  mkdirSync(source, { recursive: true });
  assert.throws(() => copyArtifacts(source, target), /No contract JSON artifacts/);
});
