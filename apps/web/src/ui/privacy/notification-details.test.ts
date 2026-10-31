import { describe, expect, it } from 'vitest';
import { effectiveNotificationDetails } from './notification-details';

describe('whether notifications include details', () => {
  it('follows an explicit choice, whatever the older amounts flag says', () => {
    expect(effectiveNotificationDetails('on', false)).toBe(true);
    expect(effectiveNotificationDetails('on', true)).toBe(true);
    expect(effectiveNotificationDetails('off', true)).toBe(false);
    expect(effectiveNotificationDetails('off', false)).toBe(false);
  });

  it('follows the older show-amounts choice when nothing was chosen: people who allowed amounts keep details on', () => {
    expect(effectiveNotificationDetails('auto', true)).toBe(true);
    expect(effectiveNotificationDetails('auto', false)).toBe(false);
  });
});
