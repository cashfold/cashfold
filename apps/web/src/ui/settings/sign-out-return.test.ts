import { describe, expect, it } from 'vitest';
import { returnsToSignOut } from './sign-out-return';

describe('coming back to the sign-out confirmation after a backup (FR-008)', () => {
  it('is true only for a query string that asks for it', () => {
    expect(returnsToSignOut('?then=sign-out')).toBe(true);
    expect(returnsToSignOut('then=sign-out')).toBe(true);
    expect(returnsToSignOut('?a=1&then=sign-out')).toBe(true);
  });

  it('is false for anything else, including repeated or malformed values', () => {
    expect(returnsToSignOut('')).toBe(false);
    expect(returnsToSignOut('?then=delete')).toBe(false);
    expect(returnsToSignOut('?then=sign-out-now')).toBe(false);
    expect(returnsToSignOut('?then=')).toBe(false);
    expect(returnsToSignOut('?then=sign-out&then=other')).toBe(false);
    expect(returnsToSignOut('?%E0%A4%A')).toBe(false);
  });
});
