// result.ts — pure TypeScript domain helper (no framework dependencies)
// Provides a basic Result/Either type for representing success/failure

export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${String(x)}`);
}
