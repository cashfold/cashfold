import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The desktop shell injects its own stylesheet (apps/desktop/src/main/native-feel.ts). The web app must not carry any of it, so a browser
// keeps selecting text, showing the hand on links and so on (spec 007, FR-019).
describe('the web stylesheets', () => {
  it.each(['globals.css', 'tokens.css'])('%s has none of the desktop-only rules', (file) => {
    // The slim bar of the desktop window (spec 006, US7) is in globals.css on purpose: it is only ever drawn in the desktop app, and its own rule may
    // stop selection. Nothing outside it may.
    const css = readFileSync(join(__dirname, '..', 'app', file), 'utf8').replace(/\.frame-bar \{[^}]*\}/g, '');
    expect(css).not.toMatch(/user-select\s*:\s*none/);
    expect(css).not.toMatch(/overscroll-behavior/);
    expect(css).not.toMatch(/user-drag/);
    expect(css).not.toMatch(/data-selectable/);
  });
});
