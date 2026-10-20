export interface DomainError<C extends string = string> {
  readonly code: C;
  readonly message: string;
}

export type Result<T, E = DomainError> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <C extends string>(code: C, message: string): Result<never, DomainError<C>> => ({
  ok: false,
  error: { code, message },
});
