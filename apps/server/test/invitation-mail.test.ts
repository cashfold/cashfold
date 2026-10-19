import { describe, expect, it } from 'vitest';
import { invitationMessage } from '../src/modules/mail/mail.js';

// The invitation email names the sender and nothing else (FR-107). The end-to-end checks are in the sharing suite; this pins the text.
describe('invitation message', () => {
  const m = invitationMessage('bob@example.com', 'alice@example.com', 'https://app.example.com/');

  it('is addressed to the invitee and names the sender', () => {
    expect(m.to).toBe('bob@example.com');
    expect(m.text).toContain('alice@example.com invited you');
    expect(m.subject).toBe('You have been invited to share on Cashfold');
  });

  it('points at the app, not at a Fold', () => {
    expect(m.text).toContain('https://app.example.com/folds/');
    expect(m.text).not.toMatch(/[0-9a-f]{16}/);
  });

  it('carries no money, Fold, member or key words', () => {
    expect(`${m.subject} ${m.text}`).not.toMatch(/balance|amount|budget|transaction|salary|member|password|key/i);
  });
});
