import { uuidV5, type Id } from '../../shared-kernel/id';
import type { LocalDate } from '../../shared-kernel/local-date';
import type { FieldValue, RecordState } from '../../sync/domain/merge';
import { Fields } from '../../ledger/domain/records';
import { CHECKPOINT_FIELD, TABLE } from '../../ledger/domain/tables';

// A member who joins with "from now on" history cannot read what came before, so the inviter writes down, for that one
// member, where each account and each budget stood on the joining day (ARCH 7.6, FR-102). The member starts from those
// numbers and adds what they can see afterwards. Members with the full history ignore checkpoints.

export type CheckpointKind = 'account_balance' | 'envelope_carry';
const KIND_CODE: Readonly<Record<CheckpointKind, bigint>> = { account_balance: 1n, envelope_carry: 2n };

export interface Checkpoint {
  readonly id: Id;
  readonly kind: CheckpointKind;
  /** An account id for `account_balance`, a budget id for `envelope_carry`. */
  readonly subject: Id;
  /** The joining day: what the value describes is everything dated on or before it. */
  readonly asOf: LocalDate;
  /**
   * `account_balance`: the balance at the end of `asOf`.
   * `envelope_carry`: what the budget's period holding `asOf` carries in, less what was already spent in it up to `asOf`.
   */
  readonly valueMinor: bigint;
  /** The account this checkpoint was written for. */
  readonly member: string;
}

/** One record per kind, subject and member, so writing it again for the same person replaces it. */
export const checkpointId = (fold: Id, kind: CheckpointKind, subject: Id, member: string): Id => uuidV5(fold, `cashfold.checkpoint.${kind}.${subject}.${member}`);

export function checkpointFields(c: Omit<Checkpoint, 'id'>): Map<number, FieldValue> {
  return new Map<number, FieldValue>([
    [CHECKPOINT_FIELD.kind, KIND_CODE[c.kind]], [CHECKPOINT_FIELD.subject, c.subject], [CHECKPOINT_FIELD.asOfLocalDate, BigInt(c.asOf)],
    [CHECKPOINT_FIELD.valueMinor, c.valueMinor], [CHECKPOINT_FIELD.member, c.member],
  ]);
}

export function decodeCheckpoint(rec: Id, state: RecordState): Checkpoint | undefined {
  if (state.table !== TABLE.checkpoint) return undefined;
  const f = new Fields(state);
  const kindCode = f.raw(CHECKPOINT_FIELD.kind);
  const kind = (Object.keys(KIND_CODE) as CheckpointKind[]).find((k) => KIND_CODE[k] === kindCode);
  const subject = f.id(CHECKPOINT_FIELD.subject);
  const asOf = f.int(CHECKPOINT_FIELD.asOfLocalDate, 0);
  const valueMinor = f.big(CHECKPOINT_FIELD.valueMinor);
  const member = f.text(CHECKPOINT_FIELD.member);
  if (kind === undefined || subject == null || asOf === 0 || valueMinor === undefined || member === undefined) return undefined;
  return { id: rec, kind, subject, asOf: asOf as LocalDate, valueMinor, member };
}

/** The history this device's account was given: nothing before the checkpoints written for it. */
export interface HistoryWindow {
  readonly member: string;
}
