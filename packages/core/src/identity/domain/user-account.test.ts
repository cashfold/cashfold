import { describe, expect, it } from 'vitest';
import { activate, markRegistered, newDraftAccount, normaliseEmail } from './user-account';

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  Alice.Example@Example.COM ')).toEqual({ ok: true, value: 'alice.example@example.com' });
  });

  it.each(['', 'alice', 'alice@', '@example.com', 'a b@example.com', 'alice@example', 'alice@@example.com', 'a@b@c.com', 'alice@exa mple.com', `${'a'.repeat(65)}@example.com`, `a@${'b'.repeat(250)}.com`])('rejects %j', (bad) => {
    expect(normaliseEmail(bad)).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_email' }) });
  });

  it('accepts plus tags, dots, hyphens and internationalised domains', () => {
    for (const ok of ['a+b@example.com', 'first.last@sub.example.co.uk', 'a-b_c@ex-ample.org', 'user@bücher.example']) expect(normaliseEmail(ok).ok, ok).toBe(true);
  });

  it('does not put the rejected text into the error', () => {
    expect(JSON.stringify(normaliseEmail('secret person@'))).not.toContain('secret');
  });
});

describe('account lifecycle: Draft -> Registered -> Active', () => {
  const draft = newDraftAccount({ accountId: 'ABCDEF', email: 'a@example.com', discoverable: true, server: 'https://relay.example' });

  it('starts as a draft that is not yet registered', () => {
    expect(draft).toEqual({ state: 'draft', accountId: 'ABCDEF', email: 'a@example.com', discoverable: true, server: 'https://relay.example', emailVerified: false });
  });

  it('moves forward one step at a time', () => {
    const registered = markRegistered(draft);
    expect(registered).toMatchObject({ ok: true, value: { state: 'registered' } });
    if (!registered.ok) return;
    expect(activate(registered.value)).toMatchObject({ ok: true, value: { state: 'active' } });
  });

  it('refuses to skip or repeat a step', () => {
    expect(activate(draft)).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_transition' }) });
    const registered = markRegistered(draft);
    if (!registered.ok) throw new Error('unreachable');
    expect(markRegistered(registered.value)).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_transition' }) });
  });

  it('is immutable: transitions return new values', () => {
    markRegistered(draft);
    expect(draft.state).toBe('draft');
  });
});
