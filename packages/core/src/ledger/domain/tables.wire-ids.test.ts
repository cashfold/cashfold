import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as tables from './tables';

// The table codes and field ids in tables.ts are part of the wire format (ARCHITECTURE 9.3): operations already written, stored on other
// devices and kept in backups name a field by its number. A number that is reused or renumbered would make old data read as a different
// field, silently. This test compares every id with the committed list, so the only way to change one is on purpose.
//
//   - an id that is missing or has another number is always a failure: never renumber, retire a field with a "reserved" comment instead
//     (see CATEGORY_FIELD.icon);
//   - a new id is fine, but the list must be updated in the same change, so that it keeps watching the new id too:
//       UPDATE_WIRE_IDS=1 pnpm exec vitest run packages/core/src/ledger/domain/tables.wire-ids.test.ts

const SNAPSHOT = new URL('./tables.wire-ids.json', import.meta.url);

type Maps = Record<string, Record<string, number>>;

/** Every exported map of names to numbers whose name is TABLE or ends in _FIELD. */
function currentIds(): Maps {
  const maps: Maps = {};
  for (const [name, value] of Object.entries(tables)) {
    if (name !== 'TABLE' && !name.endsWith('_FIELD')) continue;
    maps[name] = { ...(value as Record<string, number>) };
  }
  return maps;
}

function diff(committed: Maps, now: Maps) {
  const changed: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  for (const [map, entries] of Object.entries(committed)) {
    const current = now[map];
    if (current === undefined) {
      removed.push(`${map} (the whole map)`);
      continue;
    }
    for (const [key, id] of Object.entries(entries)) {
      if (!(key in current)) removed.push(`${map}.${key} (was ${id})`);
      else if (current[key] !== id) changed.push(`${map}.${key}: was ${id}, now ${current[key]}`);
    }
  }
  for (const [map, entries] of Object.entries(now)) {
    for (const [key, id] of Object.entries(entries)) if (committed[map]?.[key] === undefined) added.push(`${map}.${key} = ${id}`);
  }
  // An id given to two names in one map is also a mistake: a field would be read as another.
  const duplicates = Object.entries(now).flatMap(([map, entries]) => {
    const seen = new Map<number, string>();
    return Object.entries(entries).flatMap(([key, id]) => {
      const earlier = seen.get(id);
      seen.set(id, key);
      return earlier === undefined ? [] : [`${map}: ${earlier} and ${key} both use ${id}`];
    });
  });
  return { changed, removed, added, duplicates };
}

describe('wire ids in ledger/domain/tables.ts', () => {
  const now = currentIds();

  if (process.env['UPDATE_WIRE_IDS'] === '1') {
    it('writes the committed list', () => {
      writeFileSync(SNAPSHOT, `${JSON.stringify(now, null, 2)}\n`);
    });
    return;
  }

  const committed = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Maps;
  const result = diff(committed, now);

  it('keeps every committed id with the same number (never reuse or renumber a field)', () => {
    expect(result.removed, 'removed ids: a retired field stays in the map or in a "reserved" comment, and its number is never reused').toEqual([]);
    expect(result.changed, 'renumbered ids').toEqual([]);
  });

  it('lists every id in the committed file, so a new one is watched from now on', () => {
    expect(result.added, 'new ids: run UPDATE_WIRE_IDS=1 pnpm exec vitest run packages/core/src/ledger/domain/tables.wire-ids.test.ts').toEqual([]);
  });

  it('never gives one number to two fields of the same record', () => {
    expect(result.duplicates).toEqual([]);
  });

  it('covers the maps this guard exists for', () => {
    for (const name of ['TABLE', 'TXN_FIELD', 'TRANSFER_FIELD', 'ACCOUNT_FIELD', 'CATEGORY_FIELD', 'SCHEDULE_FIELD']) expect(Object.keys(committed), name).toContain(name);
  });
});

describe('the comparison itself', () => {
  const base: Maps = { TXN_FIELD: { note: 14, place: 15 } };

  it('flags a renumbered id', () => {
    expect(diff(base, { TXN_FIELD: { note: 15, place: 15 } }).changed).toEqual(['TXN_FIELD.note: was 14, now 15']);
  });

  it('flags a removed id and a removed map', () => {
    expect(diff(base, { TXN_FIELD: { note: 14 } }).removed).toEqual(['TXN_FIELD.place (was 15)']);
    expect(diff(base, {}).removed).toEqual(['TXN_FIELD (the whole map)']);
  });

  it('flags a new id and a reused number', () => {
    const result = diff(base, { TXN_FIELD: { note: 14, place: 15, tip: 15 } });
    expect(result.added).toEqual(['TXN_FIELD.tip = 15']);
    expect(result.duplicates).toEqual(['TXN_FIELD: place and tip both use 15']);
  });

  it('accepts an unchanged list', () => {
    expect(diff(base, base)).toEqual({ changed: [], removed: [], added: [], duplicates: [] });
  });
});
