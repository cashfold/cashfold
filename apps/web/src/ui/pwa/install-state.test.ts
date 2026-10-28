import { describe, expect, it } from 'vitest';
import { installStateOf, stepsFor, UNKNOWN_WAIT_MS, type InstallFacts } from './install-state';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const MAC_SAFARI_17 = IPAD_SAFARI;
const MAC_SAFARI_16 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0';

const facts = (over: Partial<InstallFacts> = {}): InstallFacts => ({ desktopApp: false, installedWindow: false, installedInTab: false, promptEvent: false, waitedMs: 0, steps: undefined, ...over });

describe('which kind of steps a browser needs', () => {
  it('knows Safari and the other browsers on iPhone and iPad', () => {
    expect(stepsFor({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5 })).toBe('ios-safari');
    expect(stepsFor({ userAgent: IPHONE_CHROME, maxTouchPoints: 5 })).toBe('ios-other');
  });

  it('tells an iPad, which says it is a Mac, from a Mac by its touch screen', () => {
    expect(stepsFor({ userAgent: IPAD_SAFARI, maxTouchPoints: 5 })).toBe('ios-safari');
    expect(stepsFor({ userAgent: MAC_SAFARI_17, maxTouchPoints: 0 })).toBe('mac-safari');
  });

  it('offers steps on a Mac only for Safari 17 or later, the first that can add a web app to the Dock', () => {
    expect(stepsFor({ userAgent: MAC_SAFARI_16, maxTouchPoints: 0 })).toBeUndefined();
    expect(stepsFor({ userAgent: MAC_CHROME, maxTouchPoints: 0 })).toBeUndefined();
  });

  it('offers none for Firefox on a computer', () => {
    expect(stepsFor({ userAgent: FIREFOX, maxTouchPoints: 0 })).toBeUndefined();
  });
});

describe('the install state', () => {
  it('is unknown at first, and unavailable once the wait is over with no way to install', () => {
    expect(installStateOf(facts()).kind).toBe('unknown');
    expect(installStateOf(facts({ waitedMs: UNKNOWN_WAIT_MS - 1 })).kind).toBe('unknown');
    expect(installStateOf(facts({ waitedMs: UNKNOWN_WAIT_MS })).kind).toBe('unavailable');
  });

  it('is promptable as soon as the browser hands over its install event, even after the wait', () => {
    expect(installStateOf(facts({ promptEvent: true })).kind).toBe('promptable');
    expect(installStateOf(facts({ promptEvent: true, waitedMs: UNKNOWN_WAIT_MS * 5 })).kind).toBe('promptable');
  });

  it('is steps, with the kind, where the browser installs by hand, at once', () => {
    expect(installStateOf(facts({ steps: 'ios-safari' }))).toEqual({ kind: 'steps', steps: 'ios-safari' });
    expect(installStateOf(facts({ steps: 'mac-safari' }))).toEqual({ kind: 'steps', steps: 'mac-safari' });
  });

  it('is installed in an installed window, whatever else is true', () => {
    expect(installStateOf(facts({ installedWindow: true, promptEvent: true, steps: 'ios-safari' })).kind).toBe('installed');
  });

  it('says it was installed from this tab after the install event', () => {
    expect(installStateOf(facts({ installedInTab: true })).kind).toBe('installed-in-tab');
    expect(installStateOf(facts({ installedInTab: true, promptEvent: true })).kind).toBe('installed-in-tab');
  });

  it('is unavailable in the desktop app, whatever else is true', () => {
    expect(installStateOf(facts({ desktopApp: true, promptEvent: true, steps: 'ios-safari', installedWindow: true })).kind).toBe('unavailable');
  });

  it('goes back to unavailable when a declined prompt has used up the event', () => {
    expect(installStateOf(facts({ promptEvent: true })).kind).toBe('promptable');
    expect(installStateOf(facts({ promptEvent: false, waitedMs: UNKNOWN_WAIT_MS })).kind).toBe('unavailable');
  });
});
