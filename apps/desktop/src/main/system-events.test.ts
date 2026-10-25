import type { SystemLockEvent } from '@cashfold/platform';
import { describe, expect, it, vi } from 'vitest';
import { createSystemEvents, type PowerMonitorLike } from './system-events';

function setup(over: { send?: (event: SystemLockEvent) => boolean; pageLocked?: boolean } = {}) {
  const listeners = new Map<string, () => void>();
  let idle: ReturnType<PowerMonitorLike['getSystemIdleState']> = 'active';
  const monitor: PowerMonitorLike = {
    on: (event, listener) => void listeners.set(event, listener),
    getSystemIdleState: () => idle,
  };
  let clock = 1_000_000;
  let poll: (() => void) | undefined;
  const stop = vi.fn();
  const send = vi.fn(over.send ?? (() => true));
  const onSystemLock = vi.fn();
  const events = createSystemEvents({
    monitor,
    send,
    pageLocked: () => over.pageLocked ?? false,
    onSystemLock,
    now: () => clock,
    every: (run) => {
      poll = run;
      return stop;
    },
  });
  events.start();
  return {
    events,
    send,
    onSystemLock,
    stop,
    emit: (name: string) => listeners.get(name)?.(),
    setIdle: (state: typeof idle) => (idle = state),
    tick: () => poll?.(),
    advance: (ms: number) => (clock += ms),
  };
}

describe('system lock events', () => {
  it('sends the screen locking and the computer sleeping, each with its reason', () => {
    const { emit, send, advance } = setup();
    emit('lock-screen');
    expect(send).toHaveBeenLastCalledWith({ reason: 'screen-lock' });
    advance(2_000);
    emit('suspend');
    expect(send).toHaveBeenLastCalledWith({ reason: 'suspend' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('sends the idle state once when the system reports locked, and not again until it unlocks', () => {
    const { setIdle, tick, send, advance } = setup();
    tick();
    expect(send).not.toHaveBeenCalled();
    setIdle('locked');
    tick();
    advance(5_000);
    tick();
    advance(5_000);
    tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ reason: 'idle-state' });
    setIdle('active');
    tick();
    advance(5_000);
    setIdle('locked');
    tick();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not treat merely idle as locked', () => {
    const { setIdle, tick, send } = setup();
    setIdle('idle');
    tick();
    setIdle('unknown');
    tick();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the event again on resume when the page has not said it locked', () => {
    const { emit, send, advance } = setup({ pageLocked: false });
    emit('suspend');
    advance(10_000);
    emit('resume');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ reason: 'suspend' });
  });

  it('does not send on resume when the page already locked', () => {
    const { emit, send, advance } = setup({ pageLocked: true });
    emit('suspend');
    advance(10_000);
    emit('resume');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends at most one event a second', () => {
    const { emit, send, advance } = setup();
    emit('lock-screen');
    advance(200);
    emit('suspend');
    expect(send).toHaveBeenCalledTimes(1);
    advance(900);
    emit('suspend');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('lets the other surfaces clear on every system lock, even without a window and even when the send is held back', () => {
    const { emit, send, onSystemLock, advance } = setup({ send: () => false });
    emit('lock-screen');
    advance(100);
    emit('suspend');
    expect(onSystemLock).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries immediately after a failed send, since nothing was delivered', () => {
    let window = false;
    const { emit, send, advance } = setup({ send: () => window });
    emit('lock-screen');
    advance(100);
    window = true;
    emit('lock-screen');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('stops polling when stopped', () => {
    const { events, stop } = setup();
    events.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('reports a simulated event like a real one', () => {
    const { events, send } = setup();
    events.report('idle-state');
    expect(send).toHaveBeenCalledWith({ reason: 'idle-state' });
  });
});
