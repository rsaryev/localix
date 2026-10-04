/**
 * How many rows one query result may hold, and the collector every SQL driver fills it with.
 *
 * Without a cap, `SELECT * FROM events` on a large table loaded every row into the API process —
 * the same process that runs chat — and then serialized them all into one JSON response; the
 * statement timeout bounds time, not memory. The rows past the cap were never going to be read in
 * a grid anyway: a table is BROWSED page by page, and a console result is for looking at.
 *
 * One owner for the number, because the driver that stops reading, the console that says "first
 * N rows" and the agent tool that reports truncation must all mean the same N.
 *
 * Collecting N+1 is what makes `truncated` honest: holding exactly N cannot tell a result of N rows
 * from one of a million.
 */
export const RESULT_ROW_CAP = 10_000

export interface RowCollector {
  readonly rows: unknown[][]
  /** True once a row past the cap was seen — the result is the first {@link RESULT_ROW_CAP}. */
  readonly truncated: boolean
  /** Keep `row` if there is room; answers whether the caller may STOP reading now. */
  push(row: unknown[]): boolean
}

export function createRowCollector(cap = RESULT_ROW_CAP): RowCollector {
  const rows: unknown[][] = []
  let truncated = false
  return {
    rows,
    get truncated() {
      return truncated
    },
    push(row) {
      if (rows.length < cap) {
        rows.push(row)
        return false
      }
      truncated = true
      return true
    },
  }
}

/**
 * Cap rows a driver could only read in full. The memory was already spent — this bounds only
 * what crosses the wire and what the grid renders. Drivers use it where stopping early could
 * change what a statement DOES (see each driver), and say so.
 */
export function capRows(
  rows: unknown[][],
  cap = RESULT_ROW_CAP,
): { rows: unknown[][]; truncated: boolean } {
  return rows.length > cap
    ? { rows: rows.slice(0, cap), truncated: true }
    : { rows, truncated: false }
}
