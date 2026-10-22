import { describe, expect, it, vi } from 'vitest';
import { revealDataFolder } from './data-location';

describe('opening the data folder', () => {
  it('opens exactly the folder main chose', async () => {
    const openPath = vi.fn(async () => '');
    await revealDataFolder({ userData: '/home/x/.config/Cashfold', openPath });
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith('/home/x/.config/Cashfold');
  });

  it('reports a failure to open (the system answers with a message, empty on success) without the path', async () => {
    const openPath = vi.fn(async () => 'Failed to open /home/x/.config/Cashfold');
    const failure = await revealDataFolder({ userData: '/home/x/.config/Cashfold', openPath }).catch((e: unknown) => e as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain('.config');
  });
});
