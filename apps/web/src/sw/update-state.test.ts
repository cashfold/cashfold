import { describe, expect, it } from 'vitest';
import { updateReducer, type UpdateEvent, type UpdateState } from './update-state';

const run = (events: readonly UpdateEvent[], from: UpdateState = { kind: 'idle' }): UpdateState => events.reduce(updateReducer, from);
const found = (version: string): UpdateEvent => ({ type: 'waiting-found', version });

describe('the update state', () => {
  it('starts idle, and a waiting worker makes an update ready', () => {
    expect(run([])).toEqual({ kind: 'idle' });
    expect(run([found('a')])).toEqual({ kind: 'ready', version: 'a' });
  });

  it('shows a newer version in place of an older one that is still ready', () => {
    expect(run([found('a'), found('b')])).toEqual({ kind: 'ready', version: 'b' });
    expect(run([found('a'), found('a')])).toEqual({ kind: 'ready', version: 'a' });
  });

  it('keeps a dismissed version dismissed, and shows the next version', () => {
    expect(run([found('a'), { type: 'dismiss' }])).toEqual({ kind: 'dismissed', version: 'a' });
    expect(run([found('a'), { type: 'dismiss' }, found('a')])).toEqual({ kind: 'dismissed', version: 'a' });
    expect(run([found('a'), { type: 'dismiss' }, found('b')])).toEqual({ kind: 'ready', version: 'b' });
  });

  it('applies when nothing is unsaved', () => {
    expect(run([found('a'), { type: 'apply', unsaved: false }])).toEqual({ kind: 'applying', version: 'a' });
  });

  it('never applies while there is unsaved input: it is blocked, and ready again once that is gone', () => {
    const blocked = run([found('a'), { type: 'apply', unsaved: true }]);
    expect(blocked).toEqual({ kind: 'blocked', version: 'a' });
    expect(run([{ type: 'apply', unsaved: true }, { type: 'unsaved-cleared' }], blocked)).toEqual({ kind: 'ready', version: 'a' });
    expect(run([{ type: 'apply', unsaved: false }], blocked)).toEqual({ kind: 'applying', version: 'a' });
  });

  it('lets a blocked update be dismissed', () => {
    expect(run([found('a'), { type: 'apply', unsaved: true }, { type: 'dismiss' }])).toEqual({ kind: 'dismissed', version: 'a' });
  });

  it('sends every other window to restarting when one of them switched', () => {
    for (const from of [{ kind: 'idle' }, { kind: 'ready', version: 'a' }, { kind: 'dismissed', version: 'a' }, { kind: 'blocked', version: 'a' }] as const) {
      expect(run([{ type: 'controller-changed', own: false }], from)).toEqual({ kind: 'restarting-elsewhere' });
    }
  });

  it('stays applying when the switch was this window\'s own', () => {
    expect(run([found('a'), { type: 'apply', unsaved: false }, { type: 'controller-changed', own: true }])).toEqual({ kind: 'applying', version: 'a' });
  });

  it('notes a failed install only when there is no update to show, and recovers when one is found', () => {
    expect(run([{ type: 'install-failed' }])).toEqual({ kind: 'failed' });
    expect(run([found('a'), { type: 'install-failed' }])).toEqual({ kind: 'ready', version: 'a' });
    expect(run([{ type: 'install-failed' }, found('b')])).toEqual({ kind: 'ready', version: 'b' });
  });

  it('does not leave restarting-elsewhere', () => {
    expect(run([{ type: 'controller-changed', own: false }, found('a'), { type: 'dismiss' }])).toEqual({ kind: 'restarting-elsewhere' });
  });
});
