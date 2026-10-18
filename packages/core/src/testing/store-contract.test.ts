import { describe, expect, it } from 'vitest';
import { createMemoryStores, storeContract } from './index.js';

describe('in-memory stores satisfy the store contract', () => {
  for (const c of storeContract) {
    it(c.name, async () => {
      const s = createMemoryStores();
      expect(await c.run({ oplog: s.oplog, projections: s.projections, prepareFold: async () => undefined })).toEqual(c.expected);
    });
  }
});
