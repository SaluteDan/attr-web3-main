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
 *   <check> | <impact> | <contract> | <symbol> | <relative file>
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

function fingerprint(detector) {
  const first = (detector.elements && detector.elements[0]) || {};
  const mapping = first.source_mapping || {};
  const parent =
    (first.type_specific_fields && first.type_specific_fields.parent) || {};
  const contract =
    parent.name || (first.type === 'contract' ? first.name : '') || 'global';
  const symbol = first.name || '';
  const file = mapping.filename_relative || mapping.filename_short || '';
  return [
    detector.check || 'unknown',
    detector.impact || 'Unknown',
    contract,
    symbol,
    file,
  ].join(' | ');
}

const current = [...new Set(detectors.map(fingerprint))].sort();

if (writeMode) {
  const payload = {
    _comment:
      'Slither baseline — regenerate with: node scripts/util/slither-baseline.js --write',
    generatedAt: new Date().toISOString().slice(0, 10),
    fingerprints: current,
  };
  writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `[slither-baseline] wrote ${current.length} fingerprint(s) to ${BASELINE}`,
  );
  process.exit(0);
}

const baseline = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).fingerprints || [])
  : new Set();

const newFindings = current.filter((f) => !baseline.has(f));
const resolved = [...baseline].filter((f) => !current.includes(f));

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
  console.error(
    '\nFix the finding(s), or — if reviewed and accepted — refresh the ' +
      'baseline with: node scripts/util/slither-baseline.js --write',
  );
  process.exit(1);
}

console.log('[slither-baseline] no new findings — OK');
