// The field registry (data-model §2, contracts/form-fields.md): which fields each form has and how prominent each is. Compile-time only,
// never stored. Classes: E essential (always shown), O optional (in "More details" unless made default-visible), T technical (Advanced only).
export type FieldClass = 'E' | 'O' | 'T';
export type FormId = 'transaction' | 'transfer' | 'account' | 'category' | 'budget' | 'goal' | 'schedule' | 'fold';
export type FieldValues = Readonly<Record<string, unknown>>;

export interface FieldDef {
  id: string;
  form: FormId;
  cls: FieldClass;
  /** For optional fields: shown without expanding "More details" when the person has not chosen. Essential fields are always shown. */
  defaultVisible: boolean;
  /** The type switch in the sheet header (expense / income / transfer); it is not counted among the default fields. */
  headerSwitch?: true;
  /** Rendered in the same row as another field (`sc.every` beside `sc.repeats`) or as its alternative; not counted separately. */
  sharesRowWith?: string;
  /** Whether the field applies to the form's current state (e.g. a refund only for income). Absent: always. */
  appliesTo?: (values: FieldValues) => boolean;
  /** Whether the person has put a value in it. Absent: the generic test (non-empty, not false). */
  hasValue?: (values: FieldValues) => boolean;
}

const kindIs = (key: string, ...kinds: string[]) => (v: FieldValues) => kinds.includes(String(v[key]));
const txKind = (...kinds: string[]) => kindIs('tx.kind', ...kinds);
const notAdjustment = txKind('expense', 'income');

const E = (id: string, form: FormId, extra: Partial<FieldDef> = {}): FieldDef => ({ id, form, cls: 'E', defaultVisible: true, ...extra });
const O = (id: string, form: FormId, extra: Partial<FieldDef> = {}): FieldDef => ({ id, form, cls: 'O', defaultVisible: false, ...extra });
const T = (id: string, form: FormId, extra: Partial<FieldDef> = {}): FieldDef => ({ id, form, cls: 'T', defaultVisible: false, ...extra });

export const FIELDS: readonly FieldDef[] = [
  // Transaction
  E('tx.kind', 'transaction', { headerSwitch: true }),
  E('tx.amount', 'transaction'),
  E('tx.account', 'transaction'),
  E('tx.category', 'transaction', { appliesTo: notAdjustment }),
  E('tx.when', 'transaction'),
  O('tx.payee', 'transaction', { appliesTo: notAdjustment }),
  O('tx.tags', 'transaction', { appliesTo: notAdjustment }),
  O('tx.note', 'transaction'),
  O('tx.attachment', 'transaction', { appliesTo: notAdjustment }),
  O('tx.place', 'transaction', { appliesTo: notAdjustment }),
  O('tx.status', 'transaction'),
  O('tx.refund', 'transaction', { appliesTo: txKind('income') }),
  O('tx.pin', 'transaction'),
  T('tx.coordinates', 'transaction', { appliesTo: notAdjustment }),
  // Transfer
  E('xf.from', 'transfer'),
  E('xf.to', 'transfer'),
  E('xf.amount', 'transfer'),
  E('xf.received', 'transfer', { appliesTo: (v) => v['xf.currenciesDiffer'] === true }),
  E('xf.when', 'transfer'),
  O('xf.note', 'transfer'),
  T('xf.rate', 'transfer'),
  // Account
  E('ac.name', 'account'),
  E('ac.currency', 'account'),
  E('ac.kind', 'account'),
  E('ac.opening', 'account'),
  O('ac.openingDate', 'account'),
  O('ac.groups', 'account'),
  // Category, tag, payee
  E('ca.name', 'category'),
  O('ca.parent', 'category'),
  E('ca.direction', 'category'),
  // Budget
  E('bu.name', 'budget'),
  E('bu.limit', 'budget'),
  E('bu.period', 'budget'),
  E('bu.start', 'budget'),
  E('bu.categories', 'budget'),
  O('bu.every', 'budget'),
  O('bu.allocation', 'budget'),
  O('bu.accounts', 'budget'),
  O('bu.groups', 'budget'),
  O('bu.tags', 'budget'),
  O('bu.rollover', 'budget'),
  // Goal
  E('go.name', 'goal'),
  E('go.target', 'goal'),
  E('go.account', 'goal'),
  E('go.date', 'goal'),
  // Schedule
  E('sc.name', 'schedule'),
  E('sc.kind', 'schedule', { headerSwitch: true }),
  E('sc.account', 'schedule'),
  E('sc.toAccount', 'schedule', { sharesRowWith: 'sc.category', appliesTo: kindIs('sc.kind', 'transfer') }),
  E('sc.amount', 'schedule'),
  E('sc.category', 'schedule', { appliesTo: kindIs('sc.kind', 'expense', 'income') }),
  E('sc.repeats', 'schedule'),
  E('sc.every', 'schedule', { sharesRowWith: 'sc.repeats' }),
  E('sc.begin', 'schedule'),
  O('sc.note', 'schedule'),
  O('sc.end', 'schedule'),
  O('sc.confirm', 'schedule'),
  O('sc.reminder', 'schedule'),
  // Fold
  E('fo.name', 'fold'),
  E('fo.currency', 'fold'),
];

export const fieldsOf = (form: FormId): readonly FieldDef[] => FIELDS.filter((f) => f.form === form);
export const fieldById = (id: string): FieldDef | undefined => FIELDS.find((f) => f.id === id);

/** The optional fields of a form, in order: what Settings → Appearance lets the person pull out of "More details" (FR-021). */
export const optionalFieldsOf = (form: FormId): readonly FieldDef[] => fieldsOf(form).filter((f) => f.cls === 'O');

export function hasValue(def: FieldDef, values: FieldValues): boolean {
  if (def.hasValue) return def.hasValue(values);
  const v = values[def.id];
  if (v === undefined || v === null || v === '' || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
