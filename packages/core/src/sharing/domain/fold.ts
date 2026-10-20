import { parseCurrency } from '../../shared-kernel/currency';
import { uuidV5, type Id } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { FieldValue } from '../../sync/domain/merge';

// A Fold is a private vault: its own key, its own data, its own members (FR-020, FR-021). Its name and base
// currency are ordinary synced fields of one settings record (table 13), so every member sees renames.

export const MAX_FOLD_NAME = 80;
export const SETTINGS_TABLE = 13;
export const FOLD_SETTINGS_FIELDS = { name: 1, baseCurrency: 2, server: 3 } as const;

export type FoldError = DomainError<'invalid_fold_name' | 'unknown_currency'>;

export interface NewFold {
  readonly name: string;
  readonly baseCurrency: string;
}

export function validateFoldName(text: string): Result<string, FoldError> {
  const name = text.trim();
  const length = Array.from(name).length;
  if (length < 1 || length > MAX_FOLD_NAME || /\p{Cc}/u.test(name)) {
    return err('invalid_fold_name', `A Fold name has 1 to ${MAX_FOLD_NAME} characters and no line breaks`);
  }
  return ok(name);
}

export function validateNewFold(input: NewFold): Result<NewFold, FoldError> {
  const name = validateFoldName(input.name);
  if (!name.ok) return name;
  const currency = parseCurrency(input.baseCurrency);
  if (!currency.ok) return currency;
  return ok({ name: name.value, baseCurrency: currency.value });
}

/** The settings record has a fixed, derived id so that every device addresses the same record. */
export const settingsRecordId = (fold: Id): Id => uuidV5(fold, 'cashfold.fold.settings');

export function foldSettingsPatch(settings: { name?: string; baseCurrency?: string; server?: string }): { table: number; fields: ReadonlyMap<number, FieldValue> } {
  const fields = new Map<number, FieldValue>();
  if (settings.name !== undefined) fields.set(FOLD_SETTINGS_FIELDS.name, settings.name);
  if (settings.baseCurrency !== undefined) fields.set(FOLD_SETTINGS_FIELDS.baseCurrency, settings.baseCurrency);
  if (settings.server !== undefined) fields.set(FOLD_SETTINGS_FIELDS.server, settings.server);
  return { table: SETTINGS_TABLE, fields };
}
