// The external security review as a release gate (Constitution, Workflow; T203). A release may be published only when
// docs/security-review/status.md says the review is complete, names who did it and where the report is, and no critical or high
// finding is still open. Run by the release workflow; exits 1 with the reasons otherwise.
import { readFileSync } from 'node:fs';

const field = (text, name) => new RegExp(`^[-*]\\s*\\*{0,2}${name}\\*{0,2}[ \\t]*:[ \\t]*(.*)$`, 'im').exec(text)?.[1]?.replace(/<!--.*?-->/g, '').trim() ?? '';

/** @param {string} text the contents of status.md @returns {{ ok: boolean, problems: string[] }} */
export function checkReviewStatus(text) {
  const problems = [];
  if (field(text, 'Status').toLowerCase() !== 'complete') problems.push(`status is "${field(text, 'Status') || 'missing'}", not "complete"`);
  for (const name of ['Reviewer', 'Completed', 'Report']) if (field(text, name) === '') problems.push(`"${name}" is empty`);
  const completed = field(text, 'Completed');
  if (completed !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(completed)) problems.push(`"Completed" is not a date (YYYY-MM-DD): "${completed}"`);

  const findings = text.split('\n').filter((l) => /^\|\s*[A-Z]+-\d+\s*\|/.test(l)).map((l) => l.split('|').map((c) => c.trim()));
  for (const [, id, severity, status] of findings) {
    const sev = (severity ?? '').toLowerCase();
    const st = (status ?? '').toLowerCase();
    if (!['fixed', 'accepted', 'wontfix', 'not applicable'].some((ok) => st.startsWith(ok)) && ['critical', 'high'].includes(sev)) problems.push(`${id}: ${sev} finding is "${status || 'unset'}"`);
    if (st === '' ) problems.push(`${id}: no status`);
  }
  return { ok: problems.length === 0, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = new URL('../docs/security-review/status.md', import.meta.url);
  const result = checkReviewStatus(readFileSync(file, 'utf8'));
  if (!result.ok) {
    console.error('The external security review is not complete, so this release is blocked:');
    for (const p of result.problems) console.error(`  - ${p}`);
    console.error('See docs/security-review/status.md.');
    process.exit(1);
  }
  console.log('external security review: complete');
}
