import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module without types
import { checkReviewStatus } from './check-review-gate.mjs';

const doc = (head: string, findings = '') => `# Status\n\n${head}\n\n## Findings\n\n| ID | Severity | Status | Notes |\n| --- | --- | --- | --- |\n${findings}\n`;
const complete = '- Status: complete\n- Reviewer: Example Security Ltd\n- Completed: 2027-01-31\n- Report: https://example.org/report.pdf';

describe('the external review release gate', () => {
  it('blocks while the review is pending, and says why', () => {
    const r = checkReviewStatus(doc('- Status: pending\n- Reviewer:\n- Completed:\n- Report:'));
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(expect.arrayContaining(['status is "pending", not "complete"', '"Reviewer" is empty', '"Completed" is empty', '"Report" is empty']));
  });

  it('opens only when complete, with a reviewer, a date and a report', () => {
    expect(checkReviewStatus(doc(complete)).ok).toBe(true);
    expect(checkReviewStatus(doc(complete.replace('2027-01-31', 'January'))).problems).toEqual(['"Completed" is not a date (YYYY-MM-DD): "January"']);
    expect(checkReviewStatus(doc(complete.replace('- Report: https://example.org/report.pdf', '- Report:'))).ok).toBe(false);
  });

  it('stays blocked by an open critical or high finding, but not by a fixed or accepted one, or an open lower one', () => {
    const rows = (...r: string[]) => r.join('\n');
    expect(checkReviewStatus(doc(complete, rows('| SR-1 | High | open | x |'))).problems).toEqual(['SR-1: high finding is "open"']);
    expect(checkReviewStatus(doc(complete, rows('| SR-1 | Critical | in progress | x |'))).ok).toBe(false);
    expect(checkReviewStatus(doc(complete, rows('| SR-1 | High | fixed in 1.2 | x |', '| SR-2 | Critical | accepted: documented in the threat model | x |', '| SR-3 | Medium | open | x |', '| SR-4 | Low | open | x |'))).ok).toBe(true);
    expect(checkReviewStatus(doc(complete, '| SR-5 | Low |  | x |')).problems).toEqual(['SR-5: no status']);
  });

  it('is not fooled by the template placeholder text, or the heading', () => {
    expect(checkReviewStatus('# External security review\n\nStatus: complete\n').ok).toBe(false);
  });

  it('can read the real status file: it has a status line and a findings table', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../docs/security-review/status.md', import.meta.url), 'utf8');
    expect(text).toMatch(/^- Status: /m);
    expect(text).toMatch(/\| ID \| Severity \| Status \|/);
    expect(typeof checkReviewStatus(text).ok).toBe('boolean');
  });
});
