// Security headers for static hosting (Constitution VIII; ARCH §10).
// Emit these from the host (e.g. _headers file / reverse proxy). No third-party scripts anywhere.

export interface CspOptions {
  /** Relay origins the client may talk to, e.g. ["https://relay.example.com"]. */
  readonly connectSources: readonly string[];
}

export function contentSecurityPolicy({ connectSources }: CspOptions): string {
  const connect = ["'self'", ...connectSources].join(' ');
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    'require-trusted-types-for \'script\'',
  ].join('; ');
}

export function securityHeaders(options: CspOptions): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(options),
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), publickey-credentials-get=(self)',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}
