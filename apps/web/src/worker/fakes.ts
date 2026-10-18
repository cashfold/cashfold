// In-memory stand-ins for Web Locks and BroadcastChannel, for tests.
import type { ChannelLike, LocksLike } from './leader';

/** Exclusive named locks with a FIFO queue, as navigator.locks behaves for mode "exclusive". */
export function createFakeLocks(): LocksLike {
  const held = new Set<string>();
  const queues = new Map<string, Array<() => void>>();
  const run = async <T>(name: string, cb: (lock: { name: string } | null) => Promise<T> | T): Promise<T> => {
    held.add(name);
    try {
      return await cb({ name });
    } finally {
      held.delete(name);
      queues.get(name)?.shift()?.();
    }
  };
  return {
    request(name, options, cb) {
      if (!held.has(name)) return run(name, cb);
      if (options?.ifAvailable) return Promise.resolve(cb(null));
      return new Promise((resolve, reject) => {
        const q = queues.get(name) ?? [];
        q.push(() => run(name, cb).then(resolve, reject));
        queues.set(name, q);
      });
    },
  } as LocksLike;
}

/** A broadcast bus: every channel on the same bus hears every message except its own. */
export function createFakeBus() {
  const channels = new Set<FakeChannel>();
  class FakeChannel implements ChannelLike {
    private listeners = new Set<(data: unknown) => void>();
    postMessage(data: unknown) {
      const copy = structuredClone(data);
      for (const c of channels) if (c !== this) queueMicrotask(() => c.listeners.forEach((l) => l(copy)));
    }
    addEventListener(_t: 'message', fn: (e: { data: unknown }) => void) {
      const wrapped = (data: unknown) => fn({ data });
      (fn as unknown as { _w?: typeof wrapped })._w = wrapped;
      this.listeners.add(wrapped);
    }
    removeEventListener(_t: 'message', fn: (e: { data: unknown }) => void) {
      const w = (fn as unknown as { _w?: (d: unknown) => void })._w;
      if (w) this.listeners.delete(w);
    }
    close() {
      channels.delete(this);
    }
  }
  return {
    open(): ChannelLike {
      const c = new FakeChannel();
      channels.add(c);
      return c;
    },
  };
}
