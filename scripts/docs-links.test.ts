import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every relative link in the hand-written documentation points at a file that exists, and every `#anchor` at a heading that exists. Links
// to other sites are not followed. Generated files, vendored text and the spec-kit workspace are left out (the same set as .prettierignore).

const SKIPPED = [
  /^CHANGELOG\.md$/,
  /^THIRD_PARTY_NOTICES\.md$/,
  /^docs\/protocol\.md$/,
  /^docs\/reference\//,
  /^apps\/web\/src\/ui\/kit\//,
  /^specs\//,
  /^\.specify\//,
  /^\.claude\//,
];

const files = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => file !== '' && existsSync(file) && !SKIPPED.some((skip) => skip.test(file)));

/** Without fenced code blocks and inline code, whose brackets are not links. */
function prose(markdown: string): string {
  return markdown.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '');
}

/** GitHub's anchor for a heading: lower case, punctuation removed, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // a link keeps its text
    .replace(/[`*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

function anchors(file: string): Set<string> {
  const seen = new Map<string, number>();
  const result = new Set<string>();
  for (const line of prose(readFileSync(file, 'utf8')).split('\n')) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading === null) continue;
    const base = slug(heading[1]!);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count === 0 ? base : `${base}-${count}`); // repeated headings get -1, -2, ...
  }
  return result;
}

function links(file: string): string[] {
  const text = prose(readFileSync(file, 'utf8'));
  const inline = [...text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]!);
  const references = [...text.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?\s*$/gm)].map((m) => m[1]!);
  return [...inline, ...references];
}

describe('links in the documentation', () => {
  it('covers the pages people read first', () => {
    for (const page of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/README.md']) expect(files).toContain(page);
  });

  it.each(files)('%s: relative links and anchors resolve', (file) => {
    const broken: string[] = [];
    for (const target of links(file)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue; // https:, mailto:, ...
      const [path = '', hash] = target.split('#') as [string, string | undefined];
      const resolved = path === '' ? file : normalize(join(dirname(file), decodeURIComponent(path)));
      if (!existsSync(resolved)) {
        broken.push(`${target} (no such file)`);
        continue;
      }
      if (hash !== undefined && hash !== '' && resolved.endsWith('.md') && statSync(resolved).isFile() && !anchors(resolved).has(hash.toLowerCase())) {
        broken.push(`${target} (no such heading)`);
      }
    }
    expect(broken).toEqual([]);
  });
});
