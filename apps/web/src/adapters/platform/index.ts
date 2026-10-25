import { AboutInfoSchema, AutoCheckResponseSchema, UpdateStateSchema, type DesktopBridge, type UpdateState } from '@cashfold/platform';
import { findRawBridge } from './detect';

// The desktop app's window exposes one global, `cashfoldDesktop` (apps/desktop, specs/003 contract). In the plain web app it does not exist and
// nothing here does anything. When it does exist, whatever it says is checked again against the shared schemas before the interface sees it:
// the page treats the shell as a collaborator to be verified, not as trusted code.

const ERROR_STATE: UpdateState = { kind: 'error', code: 'unknown' };
/** One checked wrapper per bridge object, so the page keeps seeing the same instance. */
const wrapped = new WeakMap<object, DesktopBridge>();

/** The desktop bridge, or undefined in the web app. */
export function getDesktopBridge(host: object = globalThis): DesktopBridge | undefined {
  const raw = findRawBridge(host) as DesktopBridge | undefined;
  if (raw === undefined) return undefined;
  const known = wrapped.get(raw);
  if (known !== undefined) return known;
  const bridge = harden(raw);
  wrapped.set(raw, bridge);
  return bridge;
}

async function asState(call: () => Promise<unknown>): Promise<UpdateState> {
  try {
    const parsed = UpdateStateSchema.safeParse(await call());
    return parsed.success ? parsed.data : ERROR_STATE;
  } catch {
    return ERROR_STATE;
  }
}

function harden(bridge: DesktopBridge): DesktopBridge {
  const { updates } = bridge;
  return {
    about: async () => AboutInfoSchema.parse(await bridge.about()),
    revealDataFolder: () => bridge.revealDataFolder(),
    setLanguage: (language) => bridge.setLanguage(language),
    updates: {
      state: () => asState(() => updates.state()),
      check: () => asState(() => updates.check()),
      download: () => asState(() => updates.download()),
      install: () => updates.install(),
      openReleasePage: () => updates.openReleasePage(),
      autoCheck: async () => {
        const parsed = AutoCheckResponseSchema.safeParse(await updates.autoCheck());
        return parsed.success ? parsed.data : true;
      },
      setAutoCheck: (on) => updates.setAutoCheck(on),
      onChange(listener) {
        return updates.onChange((state) => {
          const parsed = UpdateStateSchema.safeParse(state);
          if (parsed.success) listener(parsed.data);
        });
      },
    },
  };
}
