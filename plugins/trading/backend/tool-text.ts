/**
 * The model-facing text primitives every trading TOOL shares.
 *
 * `market_data`, `portfolio` and `manage_orders` each render their own prose, but they
 * all have to answer the same two questions first: what does a thrown value SAY, and what
 * does a number that the venue never reported LOOK LIKE. Each tool had written its own
 * answer — three byte-identical copies of `errText`, two of `num` — which is the failure
 * mode a copy has by construction: it agrees with its original, so no test and no compiler
 * can tell you it is there. It only surfaces the day one of the three is fixed.
 *
 * These stay DUCK-TYPED on purpose. A tool speaks to its narrow port, not to the service's
 * error class, so `errCode` reads the `code` property off whatever was thrown rather than
 * importing `TradingError`. (The `TradingErrorCode` union is a type import — erased, no
 * runtime coupling.)
 */
import type { TradingErrorCode } from './errors'

/** Flatten a thrown value to its message so an unreachable venue reads as text, not a crash. */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The stable `code` a `TradingError` carries, duck-typed so a tool imports no error class. */
export function errCode(err: unknown): TradingErrorCode | undefined {
  const code = (err as { code?: unknown })?.code
  return typeof code === 'string' && code ? (code as TradingErrorCode) : undefined
}

/** The venue declined the read outright — a capability gap, not a failure to reach it. */
export function isNotSupported(err: unknown): boolean {
  return errCode(err) === 'not_supported'
}

/** A figure the venue did not report is UNKNOWN (`—`), never `0`. Absence is not zero. */
export const num = (v: number | undefined): string => (v === undefined ? '—' : String(v))
