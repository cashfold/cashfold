// Exactly one Core Worker may own the database (ARCH 8.1a). The Web Locks API arbitrates: whoever holds the named
// lock is the leader; other tabs follow and send their calls to it.

export interface LocksLike {
  request<T>(name: string, options: { ifAvailable?: boolean; mode?: 'exclusive' }, callback: (lock: unknown) => Promise<T> | T): Promise<T>;
}

export interface ChannelLike {
  postMessage(data: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export interface Leader {
  readonly role: 'leader';
  /** Gives up leadership (the lock is released). Idempotent. */
  relinquish(): void;
}

export interface Follower {
  readonly role: 'follower';
  readonly relinquish?: undefined;
  /** Resolves when the current leader goes away and this tab takes over. */
  whenLeader(): Promise<Leader>;
}

export type Leadership = Leader | Follower;

const hold = (resolve: (l: Leader) => void) => () =>
  new Promise<void>((release) => resolve({ role: 'leader', relinquish: () => release() }));

/** Tries for the lock without waiting. The holder is the leader; anyone else is a follower. */
export function acquire(locks: LocksLike, name: string): Promise<Leadership> {
  return new Promise((resolve) => {
    void locks.request(name, { ifAvailable: true, mode: 'exclusive' }, (lock) => {
      if (lock === null || lock === undefined) {
        resolve({
          role: 'follower',
          whenLeader: () => new Promise<Leader>((res) => void locks.request(name, { mode: 'exclusive' }, hold(res))),
        });
        return undefined;
      }
      return hold(resolve)();
    });
  });
}
