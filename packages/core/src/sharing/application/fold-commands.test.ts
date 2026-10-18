import { describe, expect, it } from 'vitest';
import type { Id } from '../../shared-kernel/id';
import type { Role } from '../../shared-kernel/role';
import { createCommandBus, createEventBus } from '../../sync/application/buses';
import { createReplica, createWorld, id, type Replica, type World } from '../../testing/index';
import { settingsRecordId } from '../domain/fold';
import type { FoldDirectory, FoldKeyPort, FoldSummary } from '../ports/index';
import { createFoldCommands, describeFoldDeletion, roleResolver } from './fold-commands';

function memoryDirectory(): FoldDirectory & { removed: Id[] } {
  const folds = new Map<Id, FoldSummary>();
  const removed: Id[] = [];
  return {
    removed,
    list: async () => [...folds.values()],
    get: async (fold) => folds.get(fold),
    add: async (f) => void folds.set(f.id, f),
    rename: async (fold, name) => void folds.set(fold, { ...folds.get(fold)!, name }),
    remove: async (fold) => (folds.delete(fold), void removed.push(fold)),
  };
}

async function setup(unlocked = true) {
  const world: World = await createWorld();
  const replica: Replica = await createReplica(world, { device: id(0xa) });
  const directory = memoryDirectory();
  const dropped: Id[] = [];
  const foldKeys: FoldKeyPort = {
    async createFoldKey(fold) { world.addFold(fold); return 1; },
    async dropFoldKeys(fold) { dropped.push(fold); world.dropFold(fold); },
  };
  const bus = createCommandBus({
    writePath: replica.writePath, projections: replica.projections, events: createEventBus(),
    roleOf: roleResolver(directory), isUnlocked: () => unlocked,
  });
  const commands = createFoldCommands({ directory, foldKeys });
  return { replica, directory, dropped, bus, commands };
}

const FOLD = id(0xf1);

describe('createFold', () => {
  it('registers the Fold locally as its owner, creates its key and writes the settings record', async () => {
    const { bus, commands, directory, replica } = await setup();
    const result = await bus.execute(commands.createFold, { fold: FOLD, name: '  Personal ', baseCurrency: 'USD' });
    expect(result).toEqual({ ok: true, value: { id: FOLD, name: 'Personal', baseCurrency: 'USD', epoch: 1, role: 'owner' } });
    expect(await directory.list()).toHaveLength(1);
    const settings = await replica.projections.getRecord(FOLD, settingsRecordId(FOLD));
    expect(settings?.table).toBe(13);
    expect(settings?.fields.get(1)?.value).toBe('Personal');
    expect(settings?.fields.get(2)?.value).toBe('USD');
    expect((await replica.oplog.list(FOLD))[0]?.sealed.epoch).toBe(1);
  });

  it('rejects an invalid name or currency before creating anything', async () => {
    const { bus, commands, directory, dropped } = await setup();
    expect(await bus.execute(commands.createFold, { fold: FOLD, name: '', baseCurrency: 'USD' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_fold_name' }) });
    expect(await bus.execute(commands.createFold, { fold: FOLD, name: 'x', baseCurrency: 'XXX' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'unknown_currency' }) });
    expect(await directory.list()).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it('refuses a Fold id that already exists', async () => {
    const { bus, commands } = await setup();
    await bus.execute(commands.createFold, { fold: FOLD, name: 'A', baseCurrency: 'USD' });
    expect(await bus.execute(commands.createFold, { fold: FOLD, name: 'B', baseCurrency: 'EUR' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'fold_exists' }) });
  });

  it('is refused while the app is locked', async () => {
    const { bus, commands } = await setup(false);
    expect(await bus.execute(commands.createFold, { fold: FOLD, name: 'A', baseCurrency: 'USD' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'locked' }) });
  });

  it('leaves no key or directory entry behind when writing the settings fails', async () => {
    const { bus, commands, directory, dropped, replica } = await setup();
    replica.failNextProjectionWrite();
    await expect(bus.execute(commands.createFold, { fold: FOLD, name: 'A', baseCurrency: 'USD' })).rejects.toThrow('disk full');
    expect(dropped).toEqual([FOLD]);
    expect(await directory.list()).toEqual([]);
  });
});

describe('renameFold', () => {
  it('changes the name everywhere: directory and the synced settings record', async () => {
    const { bus, commands, directory, replica } = await setup();
    await bus.execute(commands.createFold, { fold: FOLD, name: 'Old', baseCurrency: 'USD' });
    expect(await bus.execute(commands.renameFold, { fold: FOLD, name: 'New name' })).toEqual({ ok: true, value: 'New name' });
    expect((await directory.get(FOLD))?.name).toBe('New name');
    expect((await replica.projections.getRecord(FOLD, settingsRecordId(FOLD)))?.fields.get(1)?.value).toBe('New name');
  });

  it('rejects an invalid name and changes nothing', async () => {
    const { bus, commands, directory } = await setup();
    await bus.execute(commands.createFold, { fold: FOLD, name: 'Old', baseCurrency: 'USD' });
    expect(await bus.execute(commands.renameFold, { fold: FOLD, name: 'x'.repeat(81) })).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_fold_name' }) });
    expect((await directory.get(FOLD))?.name).toBe('Old');
  });

  it('is for owners only', async () => {
    const { bus, commands, directory } = await setup();
    await bus.execute(commands.createFold, { fold: FOLD, name: 'Old', baseCurrency: 'USD' });
    for (const role of ['viewer', 'editor'] as Role[]) {
      await directory.add({ ...(await directory.get(FOLD))!, role });
      expect(await bus.execute(commands.renameFold, { fold: FOLD, name: 'Nope' }), role).toEqual({ ok: false, error: expect.objectContaining({ code: 'permission_denied', roleRequired: 'owner' }) });
    }
  });
});

describe('deleteFold (FR-022: explicit confirmation, consequence stated)', () => {
  async function twoFolds() {
    const s = await setup();
    await s.bus.execute(s.commands.createFold, { fold: FOLD, name: 'Household', baseCurrency: 'USD' });
    await s.bus.execute(s.commands.createFold, { fold: id(0xf2), name: 'Personal', baseCurrency: 'EUR' });
    return s;
  }

  it('describes what deleting will do before asking for confirmation', async () => {
    const { directory } = await twoFolds();
    expect(await describeFoldDeletion(directory, FOLD)).toEqual({ name: 'Household', memberCount: 1, isLastFold: false });
  });

  it('requires the exact Fold name as confirmation', async () => {
    const { bus, commands, directory } = await twoFolds();
    expect(await bus.execute(commands.deleteFold, { fold: FOLD, confirmName: 'household' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'confirmation_mismatch' }) });
    expect(await bus.execute(commands.deleteFold, { fold: FOLD, confirmName: '' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'confirmation_mismatch' }) });
    expect(await directory.list()).toHaveLength(2);
  });

  it('removes the Fold, its key and its local data once confirmed', async () => {
    const { bus, commands, directory, dropped } = await twoFolds();
    expect(await bus.execute(commands.deleteFold, { fold: FOLD, confirmName: ' Household ' })).toEqual({ ok: true, value: true });
    expect((await directory.list()).map((f) => f.id)).toEqual([id(0xf2)]);
    expect(directory.removed).toEqual([FOLD]);
    expect(dropped).toEqual([FOLD]);
  });

  it('never deletes the last Fold: every user keeps at least one (FR-020)', async () => {
    const { bus, commands, directory } = await setup();
    await bus.execute(commands.createFold, { fold: FOLD, name: 'Only', baseCurrency: 'USD' });
    expect(await describeFoldDeletion(directory, FOLD)).toMatchObject({ isLastFold: true });
    expect(await bus.execute(commands.deleteFold, { fold: FOLD, confirmName: 'Only' })).toEqual({ ok: false, error: expect.objectContaining({ code: 'last_fold' }) });
    expect(await directory.list()).toHaveLength(1);
  });

  it('leaves the other Fold untouched', async () => {
    const { bus, commands, replica } = await twoFolds();
    await bus.execute(commands.deleteFold, { fold: FOLD, confirmName: 'Household' });
    expect((await replica.projections.getRecord(id(0xf2), settingsRecordId(id(0xf2))))?.fields.get(1)?.value).toBe('Personal');
  });
});

describe('roleResolver', () => {
  it('reads the role from the local directory and knows nothing about strangers', async () => {
    const directory = memoryDirectory();
    await directory.add({ id: FOLD, name: 'x', baseCurrency: 'USD', epoch: 1, role: 'editor' });
    const roleOf = roleResolver(directory);
    expect(await roleOf(FOLD)).toBe('editor');
    expect(await roleOf(id(0x99))).toBeUndefined();
  });
});
