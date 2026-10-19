export interface ServerConfig {
  readonly port: number;
  /** `memory` keeps everything in this process (tests, local trials); otherwise PostgreSQL at `databaseUrl`. */
  readonly store: 'memory' | 'postgres';
  readonly databaseUrl: string;
  /** Secret for the keyed MACs (email lookup, stand-in salts). At least 32 bytes, hex. */
  readonly serverSecret: Buffer;
  /** Who may create an account. */
  readonly registration: 'open' | 'invite';
  /** Codes that allow registration when `invite`. */
  readonly inviteCodes: readonly string[];
  readonly mail: { readonly kind: 'log' } | { readonly kind: 'smtp'; readonly url: string; readonly from: string } | { readonly kind: 'none' };
  /** The address clients use, put in verification links. */
  readonly publicUrl: string;
  readonly rates: { readonly kind: 'disabled' } | { readonly kind: 'upstream'; readonly url: string; readonly everyHours: number };
  /** Parameters shown for unknown addresses; the same as real accounts get from the app. */
  readonly defaultKdf: { readonly mKib: number; readonly t: number; readonly p: number };
  /** Origins allowed to call the API from a browser. */
  readonly allowedOrigins: readonly string[];
}

const flag = (v: string | undefined, fallback: string): string => (v === undefined || v === '' ? fallback : v);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const store = flag(env['STORE'], env['DATABASE_URL'] ? 'postgres' : 'memory');
  if (store !== 'memory' && store !== 'postgres') throw new Error('STORE must be memory or postgres');
  const databaseUrl = env['DATABASE_URL'] ?? '';
  if (store === 'postgres' && databaseUrl === '') throw new Error('DATABASE_URL is required with STORE=postgres');
  const secret = env['SERVER_SECRET'];
  if (secret === undefined || !/^[0-9a-f]{64,}$/i.test(secret)) throw new Error('SERVER_SECRET is required: at least 64 hex characters (32 bytes)');
  const registration = flag(env['REGISTRATION'], 'open');
  if (registration !== 'open' && registration !== 'invite') throw new Error('REGISTRATION must be open or invite');
  const mailKind = flag(env['MAIL'], 'log');
  if (mailKind !== 'log' && mailKind !== 'smtp' && mailKind !== 'none') throw new Error('MAIL must be log, smtp or none');
  if (mailKind === 'smtp' && (env['SMTP_URL'] === undefined || env['MAIL_FROM'] === undefined)) throw new Error('SMTP_URL and MAIL_FROM are required with MAIL=smtp');
  const ratesSource = flag(env['RATES_URL'], 'disabled');
  return {
    port: Number(flag(env['PORT'], '8080')),
    store,
    databaseUrl,
    serverSecret: Buffer.from(secret, 'hex'),
    registration,
    inviteCodes: (env['INVITE_CODES'] ?? '').split(',').map((c) => c.trim()).filter(Boolean),
    mail: mailKind === 'smtp' ? { kind: 'smtp', url: env['SMTP_URL']!, from: env['MAIL_FROM']! } : { kind: mailKind },
    publicUrl: flag(env['PUBLIC_URL'], 'http://localhost:3000'),
    rates: ratesSource === 'disabled' ? { kind: 'disabled' } : { kind: 'upstream', url: ratesSource, everyHours: Number(flag(env['RATES_EVERY_HOURS'], '12')) },
    defaultKdf: { mKib: 65_536, t: 3, p: 1 },
    allowedOrigins: (env['ALLOWED_ORIGINS'] ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  };
}
