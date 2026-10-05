import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Preserve Hardhat's contracts tree so dist/src/index.js can keep importing
// ../artifacts/contracts/... after tsc. Do not ship build-info or typings.
function copyTree(source, target) {
  let count = 0;
  for (const entry of readdirSync(source, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    const input = join(source, entry.name);
    const output = join(target, entry.name);
    if (entry.isDirectory()) {
      count += copyTree(input, output);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      mkdirSync(dirname(output), { recursive: true });
      copyFileSync(input, output);
      count += 1;
    }
  }
  return count;
}

export function copyArtifacts(source, target) {
  const count = copyTree(source, target);
  if (count === 0) {
    throw new Error(`No contract JSON artifacts in ${source}; run npm run compile.`);
  }
  return count;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const count = copyArtifacts(
    join(root, "artifacts/contracts"),
    join(root, "dist/artifacts/contracts"),
  );
  console.log(`Copied ${count} contract JSON artifacts into dist/artifacts/contracts.`);
}
