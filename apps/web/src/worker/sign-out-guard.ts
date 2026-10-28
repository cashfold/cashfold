// While a sign-out is running, removing this device from the service makes the sync engine report `DeviceRemoved`. That event would erase
// everything a second time and tell the person "this device was removed", which is not what they did. The guard tells the worker to drop it.

export interface SignOutGuard {
  begin(): void;
  end(): void;
  /** Whether an event of this type should be dropped right now. */
  ignores(eventType: string): boolean;
}

export function createSignOutGuard(): SignOutGuard {
  let running = 0;
  return {
    begin: () => void running++,
    end: () => void (running = Math.max(0, running - 1)),
    ignores: (eventType) => running > 0 && eventType === 'DeviceRemoved',
  };
}
