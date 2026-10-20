import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';

export type ServerAddressError = DomainError<'invalid_server'>;

const ADDRESS = /^(https?):\/\/(\[[0-9a-f:]+\]|[^\s/?#@\][]+?)(:\d{1,5})?(\/[^\s?#]*)?$/i;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Normalises the address of the user's chosen service (FR-099). The app only talks to an address the user can see and change,
 * so it must be https; plain http is allowed for the local machine only. No credentials, query or fragment.
 */
export function normaliseServerAddress(text: string): Result<string, ServerAddressError> {
  const fail = () => err('invalid_server', 'Enter a service address such as https://relay.example.com');
  const m = ADDRESS.exec(text.trim());
  if (m === null) return fail();
  const [, scheme, rawHost, port = '', path = ''] = m as unknown as [string, string, string, string | undefined, string | undefined];
  const host = rawHost.toLowerCase();
  const isIpv6 = host.startsWith('[');
  if (!isIpv6 && !host.split('.').every((label) => LABEL.test(label))) return fail();
  if (scheme!.toLowerCase() === 'http' && !LOCAL_HOSTS.has(host)) return fail();
  return ok(`${scheme!.toLowerCase()}://${host}${port}${path === '/' ? '' : path.replace(/\/$/, '')}`);
}
