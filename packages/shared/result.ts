/**
 * Result type for fail-closed control flow.
 *
 * The assurance kernel never throws across module boundaries for *expected*
 * negative outcomes (refusals, validation failures). Those are values, so a
 * caller cannot forget to handle them. Throwing is reserved for programmer
 * errors and truly unexpected conditions, which fail closed at the top level.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/** Unwrap or throw — use only at boundaries where a failure is a bug. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`Attempted to unwrap an Err: ${JSON.stringify(r.error)}`);
}
