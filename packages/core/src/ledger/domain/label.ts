import type { Id } from '../../shared-kernel/id';
import { err, ok, type DomainError, type Result } from '../../shared-kernel/result';
import type { FieldValue } from '../../sync/domain/merge';
import { cleanName } from './account';
import { LABEL_FIELD } from './tables';

// Payees and tags are plain named labels. Usage counts are derived locally and never synced.
export const MAX_LABEL_NAME = 80;

export interface Label {
  readonly id: Id;
  readonly name: string;
  readonly color: number;
}

export type LabelError = DomainError<'invalid_label_name'>;

export function validateLabelName(text: string): Result<string, LabelError> {
  const name = cleanName(text, MAX_LABEL_NAME);
  return name === undefined ? err('invalid_label_name', `A name has 1 to ${MAX_LABEL_NAME} characters and no line breaks`) : ok(name);
}

/** Case- and accent-insensitive key, so "Café" and "cafe" are recognised as the same label when merging or searching. */
export const labelKey = (name: string): string => name.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');

export function labelFieldPatch(changes: { name?: string; color?: number }): Map<number, FieldValue> {
  const f = new Map<number, FieldValue>();
  if (changes.name !== undefined) f.set(LABEL_FIELD.name, changes.name);
  if (changes.color !== undefined) f.set(LABEL_FIELD.color, BigInt(changes.color));
  return f;
}
