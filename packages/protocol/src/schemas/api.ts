/** Per-op rejection reasons returned by `POST /folds/{foldId}/ops` (sync-api.openapi.yaml, PushResult). */
export const PUSH_ERROR_CODES = ['bad_signature', 'unauthorised', 'seq_gap', 'too_large', 'unknown_epoch', 'duplicate'] as const;
export type PushErrorCode = (typeof PUSH_ERROR_CODES)[number];
