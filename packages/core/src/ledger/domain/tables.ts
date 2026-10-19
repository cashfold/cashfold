// Table codes and field ids of the ledger records (ARCHITECTURE 9.3). They are part of the wire format: once a
// code has shipped it is never reused or renumbered, only added to.

export const TABLE = {
  account: 1,
  accountGroup: 2,
  category: 3,
  payee: 4,
  tag: 5,
  transaction: 6,
  transfer: 7,
  budget: 8,
  goal: 9,
  schedule: 10,
  exchangeRate: 11,
  importBatch: 12,
  settings: 13,
  checkpoint: 14,
} as const;

export const ACCOUNT_FIELD = {
  kind: 1, name: 2, currency: 3, openingBalanceMinor: 4, openingDate: 5, includeInNetWorth: 6,
  creditLimitMinor: 7, icon: 8, color: 9, sortOrder: 10, archived: 11, groupIds: 12,
} as const;

export const GROUP_FIELD = { name: 1, icon: 2, color: 3, sortOrder: 4 } as const;

export const CATEGORY_FIELD = { direction: 1, parentId: 2, name: 3, icon: 4, color: 5, sortOrder: 6, archived: 7 } as const;

export const LABEL_FIELD = { name: 1, color: 2 } as const; // payee and tag

export const TXN_FIELD = {
  accountId: 1, direction: 2, amountMinor: 3, currency: 4, baseAmountMinor: 5, baseCurrency: 6, fxRateId: 7,
  occurredUtcMs: 8, tzOffsetMin: 9, localDate: 10, categoryId: 11, payeeId: 12, tagIds: 13, note: 14,
  placeName: 15, latE7: 16, lonE7: 17, attachmentRef: 18, isRefund: 19, isPinned: 20, status: 21,
  originScheduleId: 22, originN: 23, importId: 24, fxBaseRateId: 25,
} as const;

export const TRANSFER_FIELD = {
  fromAccountId: 1, toAccountId: 2, fromAmountMinor: 3, toAmountMinor: 4, occurredUtcMs: 5, tzOffsetMin: 6, localDate: 7,
  note: 8, status: 9, fxRateId: 10,
} as const;

export const RATE_FIELD = { quote: 1, asOfUtcS: 2, rateE12: 3, source: 4 } as const;

/** Fields that must be written together (merged atomically, FR-032). */
/** A transfer is one record; these fields merge atomically (FR-045). */
export const TRANSFER_GROUP: readonly number[] = [
  TRANSFER_FIELD.fromAccountId, TRANSFER_FIELD.toAccountId, TRANSFER_FIELD.fromAmountMinor, TRANSFER_FIELD.toAmountMinor, TRANSFER_FIELD.fxRateId,
];

export const TXN_AMOUNT_GROUP: readonly number[] = [
  TXN_FIELD.amountMinor, TXN_FIELD.currency, TXN_FIELD.baseAmountMinor, TXN_FIELD.baseCurrency, TXN_FIELD.fxRateId, TXN_FIELD.fxBaseRateId, TXN_FIELD.direction,
];
