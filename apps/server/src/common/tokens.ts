// Injection tokens. Explicit tokens (instead of type metadata) keep the build independent of decorator-metadata emit.
export const T = {
  STORE: Symbol('store'),
  AUTH: Symbol('auth'),
  SESSIONS: Symbol('sessions'),
  CONFIG: Symbol('config'),
  MAIL: Symbol('mail'),
  LIMITER: Symbol('limiter'),
  CLOCK: Symbol('clock'),
  EVENTS: Symbol('events'),
  RATES: Symbol('rates'),
  ACCOUNTS: Symbol('accounts'),
  DEVICES: Symbol('devices'),
  FOLDS: Symbol('folds'),
  SNAPSHOTS: Symbol('snapshots'),
  MEMBERSHIP: Symbol('membership'),
} as const;
