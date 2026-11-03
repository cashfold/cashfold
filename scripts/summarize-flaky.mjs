// Reads the JSON report of a Playwright run that repeated each test (`--repeat-each=N --retries=0`) and says which tests are flaky.
//
//   flaky    passed in some repeats and failed in others: the test depends on timing, order or shared state
//   failing  failed in every repeat: the test is broken, or the change under test is
//   stable   passed in every repeat
//
// Usage: node scripts/summarize-flaky.mjs <report.json>   (Markdown on stdout; exit 1 when any test failed in any repeat)
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Every test entry in the report, with the file, title and project it belongs to. */
function* testsOf(suite, file = suite.file) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) yield { file: spec.file ?? file, title: spec.title, project: test.projectName ?? '', results: test.results ?? [] };
  }
  for (const child of suite.suites ?? []) yield* testsOf(child, child.file ?? file);
}

/** The outcome of one repeat is its last attempt: with retries off there is one. Skipped repeats are not counted. */
const outcomeOf = (results) => {
  const last = results.at(-1)?.status;
  if (last === undefined || last === 'skipped') return 'skipped';
  return last === 'passed' ? 'passed' : 'failed';
};

/** @param {{ suites?: unknown[] }} report a Playwright JSON report */
export function summarize(report) {
  const byTest = new Map();
  for (const suite of report.suites ?? []) {
    for (const test of testsOf(suite)) {
      const key = `${test.file}\u0000${test.title}\u0000${test.project}`;
      const entry = byTest.get(key) ?? { file: test.file, title: test.title, project: test.project, passed: 0, failed: 0 };
      const outcome = outcomeOf(test.results);
      if (outcome === 'passed') entry.passed += 1;
      if (outcome === 'failed') entry.failed += 1;
      byTest.set(key, entry);
    }
  }
  const rows = [...byTest.values()]
    .filter((row) => row.passed + row.failed > 0)
    .map((row) => ({ ...row, verdict: row.failed === 0 ? 'stable' : row.passed === 0 ? 'failing' : 'flaky' }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.title.localeCompare(b.title));
  return { rows, flaky: rows.filter((r) => r.verdict === 'flaky'), failing: rows.filter((r) => r.verdict === 'failing') };
}

/** The Markdown for a job summary. */
export function render({ rows, flaky, failing }) {
  if (rows.length === 0) return '## Flaky-test check\n\nNo test ran. Check the spec list and the report.\n';
  const repeats = Math.max(...rows.map((r) => r.passed + r.failed));
  const head = flaky.length + failing.length === 0 ? `All ${rows.length} test(s) passed ${repeats} out of ${repeats} repeats.` : `${flaky.length} flaky and ${failing.length} failing of ${rows.length} test(s).`;
  const cell = (text) => String(text).replaceAll('|', '\\|');
  const lines = ['## Flaky-test check', '', head, '', '| Verdict | Test | Passed | Failed |', '| --- | --- | --- | --- |'];
  for (const row of [...failing, ...flaky, ...rows.filter((r) => r.verdict === 'stable')]) lines.push(`| ${row.verdict} | ${cell(`${row.file}: ${row.title} (${row.project})`)} | ${row.passed} | ${row.failed} |`);
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (path === undefined) {
    console.error('usage: node scripts/summarize-flaky.mjs <report.json>');
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    // Playwright wrote no report (it crashed before running, or the spec list was wrong): say so instead of a stack trace.
    console.error(`Cannot read the Playwright report ${path}: ${error instanceof Error ? error.message : error}`);
    process.exit(2);
  }
  const result = summarize(report);
  process.stdout.write(render(result));
  process.exit(result.flaky.length + result.failing.length > 0 || result.rows.length === 0 ? 1 : 0);
}
