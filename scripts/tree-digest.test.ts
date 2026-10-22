import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script module without types
import { digestOfSums, hashTree, sumsOf, treeDigest } from './lib/tree-digest.mjs';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tree-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe('the tree digest', () => {
  it('hashes every file under forward-slash relative paths', () => {
    expect(hashTree(tree({ 'a.txt': 'A', 'sub/b.txt': 'B' }))).toEqual({ 'a.txt': sha('A'), 'sub/b.txt': sha('B') });
  });

  it('lists "<hash>  <path>" per line in path order, ending with a newline', () => {
    const hashes = { 'b.txt': sha('B'), 'a.txt': sha('A') };
    expect(sumsOf(hashes)).toBe(`${sha('A')}  a.txt\n${sha('B')}  b.txt\n`);
  });

  it('digests the list', () => {
    const dir = tree({ 'a.txt': 'A', 'b.txt': 'B' });
    expect(treeDigest(dir)).toBe(digestOfSums(`${sha('A')}  a.txt\n${sha('B')}  b.txt\n`));
  });

  it('does not depend on creation order, only on content and paths', () => {
    expect(treeDigest(tree({ 'b.txt': 'B', 'a.txt': 'A' }))).toBe(treeDigest(tree({ 'a.txt': 'A', 'b.txt': 'B' })));
    expect(treeDigest(tree({ 'a.txt': 'A', 'b.txt': 'B' }))).not.toBe(treeDigest(tree({ 'a.txt': 'A', 'b.txt': 'C' })));
    expect(treeDigest(tree({ 'a.txt': 'A' }))).not.toBe(treeDigest(tree({ 'z.txt': 'A' })));
  });
});
