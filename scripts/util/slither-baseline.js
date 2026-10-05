#!/usr/bin/env node
/**
 * scripts/util/slither-baseline.js
 *
 * Turn a Slither JSON report into a pass/fail gate that only trips on NEW
 * findings. Slither exits 0 unless `--fail-*` flags are passed, so this script
 * provides the baseline comparison instead of failing on every historical
 * finding.
 *
 * Usage:
 *   node scripts/util/slither-baseline.js --write   # (re)generate the baseline
 *   node scripts/util/slither-baseline.js           # gate against the baseline
 *
 * Env overrides:
 *   SLITHER_REPORT    JSON report path   (default: slither-report.json)
 *   SLITHER_BASELINE  baseline path      (default: slither.baseline.json)
 *
 * A fingerprint is intentionally line-number independent so that unrelated
 * edits do not invalidate the baseline. It is:
 *   <check> | <impact> | <contract> | <symbol> | <relative file> | <detail>
 *
 * The <detail> component is a finding-specific, line-normalised form of the
 * detector description. Without it, two distinct findings that share the same
 * check + impact in the same function collapse to one fingerprint once the Set
 * dedupes them, so a genuinely NEW second finding in a baselined function is
 * silently missed. Occurrence COUNTS are also compared so that an additional
 * identical finding (same fingerprint) still trips the gate.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const writeMode = args.has('--write');
const REPORT = process.env.SLITHER_REPORT || 'slither-report.json';
const BASELINE = process.env.SLITHER_BASELINE || 'slither.baseline.json';

if (!existsSync(REPORT)) {
  console.error(`[slither-baseline] report not found: ${REPORT}`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(REPORT, 'utf8'));
} catch (error) {
  console.error(`[slither-baseline] could not parse ${REPORT}: ${error.message}`);
  process.exit(2);
}

if (report.success === false) {
  console.error(
    `[slither-baseline] slither reported failure: ${report.error || 'unknown error'}`,
  );
  process.exit(2);
}

const detectors = (report.results && report.results.detectors) || [];

/**
 * Normalise a detector description into a line-number independent,
 * finding-specific detail string. Line refs (`#12-15`) and absolute file
 * paths are stripped so unrelated edits that shift lines do not invalidate
 * the detail.
 */
function normaliseDetail(description) {
  return (description || '')
    .replace(/\n|\t/g, ' ')
    .replace(/#\d+(?:-\d+)?/g, '#')
    .replace(/\/\S+\.sol/g, 'FILE')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprint(detector) {
  const first = (detector.elements && detector.elements[0]) || {};
  const mapping = first.source_mapping || {};
  const parent =
    (first.type_specific_fields && first.type_specific_fields.parent) || {};
  const contract =
    parent.name || (first.type === 'contract' ? first.name : '') || 'global';
  const symbol = first.name || '';
  const file = mapping.filename_relative || mapping.filename_short || '';
  const detail = normaliseDetail(detector.description);
  return [
    detector.check || 'unknown',
    detector.impact || 'Unknown',
    contract,
    symbol,
    file,
    detail,
  ].join(' | ');
}

// Retain occurrence COUNTS per fingerprint so an additional finding that shares
// an existing fingerprint (e.g. another identical instance in the same
// function) still fails the gate instead of being deduped away.
const currentCounts = new Map();
for (const detector of detectors) {
  const key = fingerprint(detector);
  currentCounts.set(key, (currentCounts.get(key) || 0) + 1);
}
const current = [...currentCounts.keys()].sort();

if (writeMode) {
  const payload = {
    _comment:
      'Slither baseline — regenerate with: node scripts/util/slither-baseline.js --write',
    generatedAt: new Date().toISOString().slice(0, 10),
    fingerprints: current,
    counts: Object.fromEntries(
      [...currentCounts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  };
  writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `[slither-baseline] wrote ${current.length} fingerprint(s) to ${BASELINE}`,
  );
  process.exit(0);
}

const baselineFile = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : {};
const baseline = new Set(baselineFile.fingerprints || []);
// Older baselines predate `counts`; fall back to 1 per fingerprint (the
// minimum needed to match) so the gate still works until refreshed.
const baselineCounts = baselineFile.counts || {};

const newFindings = current.filter((f) => !baseline.has(f));
// A fingerprint present in the baseline whose occurrence count grew is also a
// NEW finding (same check/function, additional instance).
const grownFindings = current.filter(
  (f) =>
    baseline.has(f) && currentCounts.get(f) > (baselineCounts[f] ?? 1),
);
const resolved = [...baseline].filter((f) => !currentCounts.has(f));

console.log(
  `[slither-baseline] ${current.length} finding(s) in report, ${baseline.size} in baseline`,
);

if (resolved.length) {
  console.log(
    `[slither-baseline] ${resolved.length} baselined finding(s) no longer present ` +
      '(refresh the baseline to keep it tight):',
  );
  for (const f of resolved) console.log(`  - ${f}`);
}

if (newFindings.length) {
  console.error(
    `\n[slither-baseline] ${newFindings.length} NEW finding(s) not in the baseline:`,
  );
  for (const f of newFindings) console.error(`  ! ${f}`);
}

if (grownFindings.length) {
  console.error(
    `\n[slither-baseline] ${grownFindings.length} finding(s) with MORE occurrences ` +
      'than the baseline (additional instance in a baselined location):',
  );
  for (const f of grownFindings) {
    console.error(
      `  ! ${f} (report: ${currentCounts.get(f)}, baseline: ${baselineCounts[f] ?? 1})`,
    );
  }
}

if (newFindings.length || grownFindings.length) {
  console.error(
    '\nFix the finding(s), or — if reviewed and accepted — refresh the ' +
      'baseline with: node scripts/util/slither-baseline.js --write',
  );
  process.exit(1);
}

console.log('[slither-baseline] no new findings — OK');
