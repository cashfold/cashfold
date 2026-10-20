import { parseCurrency } from '../../shared-kernel/currency';
import type { RecordState } from '../../sync/domain/merge';
import { normaliseServerAddress } from '../../identity/domain/server-address';
import { FOLD_SETTINGS_FIELDS, validateFoldName } from '../domain/fold';
import type { FoldSummary } from '../ports/index';

/**
 * A Fold's name and base currency live in its settings record, so every device converges on them. The directory is a local
 * copy for fast listing; this brings it in line with the merged record, ignoring a field that is missing or not valid.
 * Returns undefined when nothing would change.
 */
export function summaryFromSettings(previous: FoldSummary, settings: RecordState): FoldSummary | undefined {
  const name = settings.fields.get(FOLD_SETTINGS_FIELDS.name)?.value;
  const currency = settings.fields.get(FOLD_SETTINGS_FIELDS.baseCurrency)?.value;
  const validName = typeof name === 'string' ? validateFoldName(name) : undefined;
  const validCurrency = typeof currency === 'string' ? parseCurrency(currency) : undefined;
  const next: FoldSummary = {
    ...previous,
    name: validName?.ok === true ? validName.value : previous.name,
    baseCurrency: validCurrency?.ok === true ? validCurrency.value : previous.baseCurrency,
  };
  return next.name === previous.name && next.baseCurrency === previous.baseCurrency ? undefined : next;
}

/**
 * Where the owner says this Fold now lives (the signed `set_server` setting, FR-100), or undefined when it has not moved or the
 * value is not a usable address. Members use it to offer moving their own account, never to move it silently.
 */
export function foldServerOf(settings: RecordState | undefined): string | undefined {
  const value = settings?.fields.get(FOLD_SETTINGS_FIELDS.server)?.value;
  if (typeof value !== 'string') return undefined;
  const address = normaliseServerAddress(value);
  return address.ok ? address.value : undefined;
}
