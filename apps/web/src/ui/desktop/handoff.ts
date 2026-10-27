// A value passed from one part of the page to another that is not on screen yet (the import panel, the restore form, the add-device screen). The
// sender offers it, the receiver takes it once when it mounts or is already there. Held in memory only, one value at a time.

export interface Handoff<T> {
  offer(value: T): void;
  /** The waiting value, once. */
  take(): T | undefined;
  subscribe(listener: () => void): () => void;
}

export function createHandoff<T>(): Handoff<T> {
  let pending: T | undefined;
  const listeners = new Set<() => void>();
  return {
    offer(value) {
      pending = value;
      listeners.forEach((listener) => listener());
    },
    take() {
      const value = pending;
      pending = undefined;
      return value;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
