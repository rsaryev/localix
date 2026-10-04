import { RESULT_ROW_CAP } from '../../../shared/result-cap'

/**
 * The row count a status line shows — ONE wording for the console bar, the `.sql` panel and the
 * result footer, because a capped result read as its size ("10,000 rows") is a wrong number the
 * user then reasons from. A capped result says "first", and the filtered form keeps saying it.
 */
export function rowCountLabel(shown: number, total: number, truncated = false): string {
  const count = (n: number) => n.toLocaleString()
  if (truncated) {
    return shown < total
      ? `${count(shown)} of first ${count(total)} rows`
      : `First ${count(total)} rows`
  }
  if (shown < total) return `${count(shown)} of ${count(total)} rows`
  return `${count(shown)} row${shown === 1 ? '' : 's'}`
}

/** Why a capped result stops where it does, for the status line's tooltip. */
export const TRUNCATED_HINT = `The result has more rows than the ${RESULT_ROW_CAP.toLocaleString()} a console result holds. Add a LIMIT, a WHERE or an aggregate, or browse the table page by page.`

/** Compact duration: `12 ms` under a second, `1.20 s` above. */
export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}
