import { describe, expect, it } from 'vitest';
import { createCluster, date, id, type Cluster } from '../../testing/index';
import { DELETED_FIELD, type FieldValue } from '../../sync/domain/merge';
import { accountFieldPatch } from '../domain/account';
import { LEDGER_GROUPS } from '../domain/ledger-groups';
import { setTo } from '../domain/sets';
import { ACCOUNT_FIELD, GROUP_FIELD, TABLE } from '../domain/tables';
import { buildLedger } from './projections/ledger';

const [A, G1, G2] = [id(1), id(70), id(71)];

async function seeded(): Promise<Cluster> {
  const c = await createCluster({ replicas: 2, groups: LEDGER_GROUPS });
  await c.edit(0, { rec: A, table: TABLE.account, sets: new Map(), fields: accountFieldPatch({ kind: 'checking', name: 'A', currency: 'USD' as never, openingBalanceMinor: 0n, openingDate: date(2020, 1, 1), includeInNetWorth: true, creditLimitMinor: null, icon: null, color: 0, sortOrder: 0, archived: false }) });
  for (const [rec, name] of [[G1, 'One'], [G2, 'Two']] as const) {
    await c.edit(0, { rec, table: TABLE.accountGroup, sets: new Map(), fields: new Map<number, FieldValue>([[GROUP_FIELD.name, name], [GROUP_FIELD.icon, null], [GROUP_FIELD.color, 0n], [GROUP_FIELD.sortOrder, 0n]]) });
  }
  await c.settle();
  return c;
}

/** What `moveAccountToGroup` writes: one op that sets the account's groups to exactly `group`. */
async function move(c: Cluster, i: number, group: typeof G1 | undefined) {
  const state = await c.replicas[i]!.projections.getRecord(c.fold, A);
  await c.edit(i, { rec: A, table: TABLE.account, fields: new Map(), sets: new Map([[ACCOUNT_FIELD.groupIds, setTo(state, ACCOUNT_FIELD.groupIds, group === undefined ? [] : [group])]]) });
}

const view = async (c: Cluster, i: number) => {
  const ledger = buildLedger(await c.replicas[i]!.projections.listRecords(c.fold));
  return { groupIds: [...ledger.accounts.get(A)!.groupIds].sort(), live: [...ledger.groups.keys()].sort() };
};

describe('concurrent moves of an account between groups', () => {
  it('two replicas moving it to different groups settle on the same state', async () => {
    const c = await seeded();
    c.setOffline(0, true);
    c.setOffline(1, true);
    await move(c, 0, G1);
    await move(c, 1, G2);
    await c.settle();
    expect(await view(c, 0)).toEqual(await view(c, 1));
  });

  it('a move to a group another replica deletes settles on the same state, with the account in no live group', async () => {
    const c = await seeded();
    c.setOffline(0, true);
    c.setOffline(1, true);
    await move(c, 0, G1);
    await c.edit(1, { rec: G1, table: TABLE.accountGroup, sets: new Map(), fields: new Map([[DELETED_FIELD, true]]) });
    await c.settle();
    const [a, b] = [await view(c, 0), await view(c, 1)];
    expect(a).toEqual(b);
    expect(a.live).toEqual([G2]);
    expect(a.groupIds.filter((g) => a.live.includes(g))).toEqual([]);
  });
});
