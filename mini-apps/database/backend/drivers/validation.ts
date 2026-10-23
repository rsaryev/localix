/**
 * The compile-only check a driver may offer (`DbDriver.validate`), and the offset arithmetic
 * every engine's answer needs.
 *
 * The console's own name checks cannot see a syntax error (`SELEC * FROM users` passed), and
 * only the engine knows its own grammar. So the engine is asked to COMPILE a statement —
 * prepare, parse, EXPLAIN AST — and never to execute it. Every adapter documents which of its
 * statement kinds that covers; a kind it cannot compile side-effect free answers `ok` with
 * `skipped: 'unsupported'` rather than a guess.
 *
 * Engines report positions in three different units (SQLite and ClickHouse: UTF-8 bytes,
 * PostgreSQL: characters, i.e. code points), while the editor addresses UTF-16 code units.
 * Converting in one place is what keeps a squiggle under the right character after an
 * `é` or an emoji earlier in the line.
 */

export type DbValidationSkip = 'busy' | 'unsupported'

export type DbValidation =
  | { ok: true; skipped?: DbValidationSkip }
  | {
      ok: false
      message: string
      /** 0-based UTF-16 offset into the validated statement, when the engine located it. */
      offset?: number
      /** Engine error code (SQLSTATE, errno, ClickHouse code …). */
      code?: string
      /**
       * The text PARSED, but a name or type did not resolve (unknown table/column). An
       * earlier statement of the same script may create that name, so the caller may
       * downgrade this to "unverified" when one precedes it.
       */
      semantic?: boolean
    }

/** Upper bound for one statement's compile round-trip; validation must never feel like a query. */
export const VALIDATE_TIMEOUT_MS = 3_000

/** UTF-16 offset of the character starting at UTF-8 byte `byteOffset`, or undefined when out of range. */
export function utf16OffsetFromUtf8(text: string, byteOffset: number): number | undefined {
  if (!Number.isInteger(byteOffset) || byteOffset < 0) return undefined
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    if (bytes >= byteOffset) return index
    const code = text.codePointAt(index)!
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (code >= 0x10000) index++
  }
  return bytes >= byteOffset ? text.length : undefined
}

/** UTF-16 offset of the `codePoints`-th code point (0-based), or undefined when out of range. */
export function utf16OffsetFromCodePoints(text: string, codePoints: number): number | undefined {
  if (!Number.isInteger(codePoints) || codePoints < 0) return undefined
  let seen = 0
  for (let index = 0; index < text.length; index++) {
    if (seen === codePoints) return index
    if (text.codePointAt(index)! >= 0x10000) index++
    seen++
  }
  return seen === codePoints ? text.length : undefined
}

/**
 * Race a compile check against {@link VALIDATE_TIMEOUT_MS} and the caller's signal. A check
 * that loses is reported as skipped (`busy`), never as an error: "the server was slow to
 * answer" says nothing about the SQL.
 */
export async function boundedValidation(
  check: (signal: AbortSignal) => Promise<DbValidation>,
  signal?: AbortSignal,
  timeoutMs = VALIDATE_TIMEOUT_MS,
): Promise<DbValidation> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) return { ok: true, skipped: 'busy' }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('validation timed out')), timeoutMs)
  const lost = new Promise<DbValidation>((resolve) =>
    controller.signal.addEventListener('abort', () => resolve({ ok: true, skipped: 'busy' }), {
      once: true,
    }),
  )
  try {
    return await Promise.race([check(controller.signal), lost])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
