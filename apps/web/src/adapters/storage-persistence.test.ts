import { describe, expect, it, vi } from 'vitest';
import { readPersistence, requestPersistence, requestPersistenceWithin, type StorageLike } from './storage-persistence';

const storage = (over: Partial<StorageLike> = {}): StorageLike => ({ persisted: async () => false, persist: async () => true, estimate: async () => ({ usage: 10, quota: 1000 }), ...over });

describe('asking the browser to keep the data', () => {
  it('asks when the data is not yet kept, and reports a yes', async () => {
    const persist = vi.fn(async () => true);
    expect(await requestPersistence(storage({ persist }))).toEqual({ supported: true, persisted: true, usageBytes: 10, quotaBytes: 1000 });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when it already is kept', async () => {
    const persist = vi.fn(async () => true);
    expect((await requestPersistence(storage({ persisted: async () => true, persist }))).persisted).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports a refusal as a refusal', async () => {
    expect((await requestPersistence(storage({ persist: async () => false }))).persisted).toBe(false);
  });

  it('says it cannot tell when the browser has no such feature or fails', async () => {
    expect((await requestPersistence(undefined)).persisted).toBeUndefined();
    expect(await requestPersistence({})).toMatchObject({ persisted: undefined });
    expect((await requestPersistence(storage({ persist: async () => { throw new Error('no'); } }))).persisted).toBeUndefined();
    expect(await readPersistence({})).toEqual({ supported: false, persisted: undefined, usageBytes: undefined, quotaBytes: undefined });
  });

  it('reads the state without asking, and copes with a missing estimate', async () => {
    const persist = vi.fn(async () => true);
    const state = await readPersistence({ persisted: async () => false, persist });
    expect(state).toEqual({ supported: true, persisted: false, usageBytes: undefined, quotaBytes: undefined });
    expect(persist).not.toHaveBeenCalled();
    expect((await readPersistence(storage({ estimate: async () => { throw new Error('x'); } }))).usageBytes).toBeUndefined();
  });
});

describe('asking without waiting on the person', () => {
  it('returns the answer at once when the browser gives one', async () => {
    const onAnswer = vi.fn();
    expect((await requestPersistenceWithin(50, onAnswer, storage())).persisted).toBe(true);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('says "cannot tell" when the browser is still asking the person, and hands over the answer when it comes', async () => {
    let answer: (yes: boolean) => void = () => undefined;
    const onAnswer = vi.fn();
    const asking = storage({ persist: () => new Promise<boolean>((resolve) => (answer = resolve)) });
    expect(await requestPersistenceWithin(10, onAnswer, asking)).toMatchObject({ supported: true, persisted: undefined });
    expect(onAnswer).not.toHaveBeenCalled();
    answer(false);
    await vi.waitFor(() => expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ persisted: false })));
  });
});
