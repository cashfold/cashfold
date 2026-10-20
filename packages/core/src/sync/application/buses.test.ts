import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../shared-kernel/result';
import type { Role } from '../../shared-kernel/role';
import { createReplica, createWorld, id, type Replica } from '../../testing/index';
import { DELETED_FIELD, type FieldValue } from '../domain/merge';
import { createCommandBus, createEventBus, createQueryBus, deriveEvents, type CommandDef, type DomainEvent, type QueryDef } from './buses';
import { type OpDraft } from './write-path';

const FOLD = id(0xf1);
const REC = id(0x10);
const fields = (...e: Array<[number, FieldValue]>) => new Map<number, FieldValue>(e);
const draft = (over: Partial<OpDraft> = {}): OpDraft => ({ fold: FOLD, rec: REC, table: 6, fields: fields([1, 'x']), sets: new Map(), ...over });

async function setup(role: Role | null = 'editor', unlocked = true) {
  const world = await createWorld();
  world.addFold(FOLD);
  const replica = await createReplica(world, { device: id(0xa) });
  const events = createEventBus();
  const seen: DomainEvent[] = [];
  events.subscribe((e) => seen.push(e));
  const deps = { writePath: replica.writePath, projections: replica.projections, events, roleOf: async () => role ?? undefined, isUnlocked: () => unlocked };
  return { replica, events, seen, commands: createCommandBus(deps), queries: createQueryBus(deps) };
}

const addNote: CommandDef<{ fold: typeof FOLD; text: string }, string, never> = {
  name: 'addNote',
  requires: 'editor',
  foldOf: (c) => c.fold,
  async handle(c, ctx) {
    const applied = await ctx.submit([draft({ fields: fields([1, c.text]) })]);
    return applied.ok ? ok('done') : (applied as never);
  },
};

describe('command bus: authorisation', () => {
  it.each([
    ['viewer', false],
    ['editor', true],
    ['owner', true],
    [null, false],
  ] as const)('role %s may run an editor command: %s', async (role, allowed) => {
    const { commands, replica } = await setup(role);
    const handled = vi.fn();
    const result = await commands.execute({ ...addNote, handle: async (c, ctx) => (handled(), addNote.handle(c, ctx)) }, { fold: FOLD, text: 'a' });
    if (allowed) {
      expect(result).toEqual({ ok: true, value: 'done' });
      expect(await replica.oplog.list(FOLD)).toHaveLength(1);
    } else {
      expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'permission_denied', roleRequired: 'editor' }) });
      expect(handled).not.toHaveBeenCalled();
      expect(await replica.oplog.list(FOLD)).toHaveLength(0);
    }
  });

  it('refuses everything while locked', async () => {
    const { commands, queries } = await setup('owner', false);
    expect(await commands.execute(addNote, { fold: FOLD, text: 'a' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'locked' }) });
    const q: QueryDef<{ fold: typeof FOLD }, number> = { name: 'count', requires: 'viewer', foldOf: (x) => x.fold, read: async () => 1 };
    expect(await queries.execute(q, { fold: FOLD })).toEqual({ ok: false, error: expect.objectContaining({ code: 'locked' }) });
  });

  it('propagates handler errors and publishes nothing for them', async () => {
    const { commands, seen } = await setup('owner');
    const failing: CommandDef<{ fold: typeof FOLD }, never, { code: 'invariant_violation'; message: string }> = {
      name: 'fails', requires: 'editor', foldOf: (c) => c.fold, handle: async () => err('invariant_violation', 'nope'),
    };
    expect(await commands.execute(failing, { fold: FOLD })).toEqual({ ok: false, error: { code: 'invariant_violation', message: 'nope' } });
    expect(seen).toEqual([]);
  });
});

describe('command bus: atomicity and events', () => {
  it('a command that submits several ops commits all of them or none', async () => {
    const { commands, replica, seen } = await setup('owner');
    const two: CommandDef<{ fold: typeof FOLD; bad: boolean }, number, never> = {
      name: 'two', requires: 'editor', foldOf: (c) => c.fold,
      async handle(c, ctx) {
        const r = await ctx.submit([draft({ rec: id(1) }), draft({ rec: id(2), table: c.bad ? 99 : 6 })]);
        return r.ok ? ok(r.value.length) : (r as never);
      },
    };
    const bad = await commands.execute(two, { fold: FOLD, bad: true });
    expect(bad).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_table' }) });
    expect(await replica.oplog.list(FOLD)).toHaveLength(0);
    expect((await replica.projections.listRecords(FOLD)).size).toBe(0);
    expect(seen).toEqual([]);

    expect(await commands.execute(two, { fold: FOLD, bad: false })).toEqual({ ok: true, value: 2 });
    expect(await replica.oplog.list(FOLD)).toHaveLength(2);
    expect((await replica.oplog.list(FOLD)).map((s) => s.sealed.seq)).toEqual([1n, 2n]); // no gap from the failed attempt
    expect(seen.map((e) => e.type)).toEqual(['RecordCreated', 'RecordCreated']);
  });

  it('publishes derived events only after the command committed', async () => {
    const { commands, seen } = await setup('owner');
    await commands.execute(addNote, { fold: FOLD, text: 'hello' });
    expect(seen).toEqual([{ type: 'RecordCreated', fold: FOLD, rec: REC, table: 6, changedFields: [1], changedSets: [] }]);
  });
});

describe('query bus', () => {
  const read: QueryDef<{ fold: typeof FOLD }, number> = {
    name: 'recordCount', requires: 'viewer', foldOf: (q) => q.fold,
    read: async (_q, ctx) => (await ctx.reader.listRecords(FOLD)).size,
  };

  it('lets viewers read and denies non-members', async () => {
    const viewer = await setup('viewer');
    await viewer.replica.writePath.submit(draft());
    expect(await viewer.queries.execute(read, { fold: FOLD })).toEqual({ ok: true, value: 1 });
    const stranger = await setup(null);
    expect(await stranger.queries.execute(read, { fold: FOLD })).toEqual({ ok: false, error: expect.objectContaining({ code: 'permission_denied', roleRequired: 'viewer' }) });
  });

  it('gives queries a read-only view', async () => {
    const { queries } = await setup('viewer');
    const probe: QueryDef<{ fold: typeof FOLD }, string[]> = { name: 'probe', requires: 'viewer', foldOf: (q) => q.fold, read: async (_q, ctx) => Object.keys(ctx.reader) };
    const r = await queries.execute(probe, { fold: FOLD });
    expect(r).toEqual({ ok: true, value: expect.not.arrayContaining(['putRecord', 'clear', 'transaction']) });
  });
});

describe('deriveEvents (projection diff)', () => {
  async function applied(...steps: Array<{ rec?: ReturnType<typeof id>; f: Array<[number, FieldValue]> }>) {
    const world = await createWorld();
    world.addFold(FOLD);
    const r: Replica = await createReplica(world, { device: id(0xa) });
    const out = [];
    for (const s of steps) {
      const res = await r.writePath.submit(draft({ rec: s.rec ?? REC, fields: fields(...s.f) }));
      if (!res.ok) throw new Error('submit failed');
      out.push(res.value);
    }
    return out;
  }

  it('Created, Changed, Deleted, Restored', async () => {
    const [create, edit, del, edit2, restore] = await applied(
      { f: [[1, 'a']] }, { f: [[1, 'b'], [2, 5n]] }, { f: [[DELETED_FIELD, true]] }, { f: [[1, 'c']] }, { f: [[DELETED_FIELD, false]] },
    );
    const types = [create, edit, del, edit2, restore].map((a) => deriveEvents(FOLD, a!).map((e) => e.type));
    expect(types).toEqual([['RecordCreated'], ['RecordChanged'], ['RecordDeleted'], [], ['RecordRestored']]);
    expect(deriveEvents(FOLD, edit!)[0]).toMatchObject({ changedFields: [1, 2] });
  });

  it('emits nothing for an op that lost every LWW comparison', async () => {
    const world = await createWorld();
    world.addFold(FOLD);
    const a = await createReplica(world, { device: id(0xa), nowMs: 2_000_000_000_000 });
    const b = await createReplica(world, { device: id(0xb), nowMs: 1_000_000_000_000 });
    await a.writePath.submit(draft({ fields: fields([1, 'newer']) }));
    await b.writePath.submit(draft({ fields: fields([1, 'older']) }));
    const [fromB] = await b.oplog.list(FOLD);
    const remote = await a.writePath.applyRemote(fromB!.sealed);
    expect(remote.ok && remote.value.kind === 'applied' ? deriveEvents(FOLD, remote.value) : null).toEqual([]);
  });

  it('reports set changes', async () => {
    const world = await createWorld();
    world.addFold(FOLD);
    const r = await createReplica(world, { device: id(0xa) });
    const res = await r.writePath.submit({ ...draft(), sets: new Map([[20, { add: [id(0x51)], rem: [] }]]) });
    if (!res.ok) throw new Error('submit failed');
    expect(deriveEvents(FOLD, res.value)[0]).toMatchObject({ type: 'RecordCreated', changedSets: [20] });
  });
});

describe('event bus', () => {
  it('delivers to every subscriber, isolates failures and supports unsubscribe', () => {
    const bus = createEventBus();
    const got: string[] = [];
    bus.subscribe(() => { throw new Error('listener bug'); });
    const off = bus.subscribe((e) => got.push(e.type));
    const event: DomainEvent = { type: 'RecordCreated', fold: FOLD, rec: REC, table: 6, changedFields: [], changedSets: [] };
    bus.publish([event]);
    off();
    bus.publish([event]);
    expect(got).toEqual(['RecordCreated']);
  });
});

describe('command bus: whole-command atomicity', () => {
  it('rolls back earlier submits when the handler later returns an error', async () => {
    const { commands, replica, seen } = await setup('owner');
    const twoStep: CommandDef<{ fold: typeof FOLD }, never, { code: 'invariant_violation'; message: string }> = {
      name: 'twoStep', requires: 'editor', foldOf: (c) => c.fold,
      async handle(_c, ctx) {
        await ctx.submit([draft({ rec: id(1) })]);
        await ctx.submit([draft({ rec: id(2) })]);
        return err('invariant_violation', 'changed my mind');
      },
    };
    expect(await commands.execute(twoStep, { fold: FOLD })).toEqual({ ok: false, error: { code: 'invariant_violation', message: 'changed my mind' } });
    expect(await replica.oplog.list(FOLD)).toHaveLength(0);
    expect((await replica.projections.listRecords(FOLD)).size).toBe(0);
    expect(seen).toEqual([]);
  });

  it('rethrows unexpected errors from handlers', async () => {
    const { commands } = await setup('owner');
    const boom: CommandDef<{ fold: typeof FOLD }, never, never> = { name: 'boom', requires: 'editor', foldOf: (c) => c.fold, handle: async () => { throw new Error('bug'); } };
    await expect(commands.execute(boom, { fold: FOLD })).rejects.toThrow('bug');
  });
});
