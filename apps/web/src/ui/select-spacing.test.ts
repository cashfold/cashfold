import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A field made with the kit's Field puts 12px (mt-3) between its label and the control. A label written by hand above a Select must leave the same gap,
// or the select sits higher than the inputs beside it. Prefer SelectField (forms/Field); a hand-written label needs `mb-3`.

const root = resolve(import.meta.dirname);

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'kit') yield* sources(path);
    } else if (/\.tsx$/.test(name) && !/\.(test|browser\.test)\.tsx$/.test(name)) yield path;
  }
}

describe('a label written by hand above a select', () => {
  it('leaves the same gap as a kit field does', () => {
    const tight: string[] = [];
    for (const file of sources(root)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const above = lines[i - 1] ?? '';
        if (!line.includes('<Select') || !/<(label|span)\b[^>]*className="[^"]*\bblock\b[^"]*"/.test(above)) return;
        if (!/\bmb-3\b/.test(above)) tight.push(`${file.slice(root.length + 1)}:${i}`);
      });
    }
    expect(tight).toEqual([]);
  });
});
