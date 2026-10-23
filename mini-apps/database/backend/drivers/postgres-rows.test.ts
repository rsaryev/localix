/**
 * The Postgres row cap at the postgres.js seam. The fake replays the library's contract as read
 * from its source: `cursor(n, fn)` hands batches of at most n rows, the FIRST batch carries the
 * statement's `columns`, a returned CLOSE ends the portal; `forEach(fn)` hands every row with its
 * owning result and keeps none, and resolves with the result (columns, count) itself.
 */
import { describe, expect, test } from 'bun:test'
import { RESULT_ROW_CAP } from '../../shared/result-cap'
import { collectPgRows, type PgRowSource } from './postgres-rows'
import { shapePgValuesResult } from './postgres'

const CLOSE = {}
const columns = [{ name: 'n' }]

function source(total: number) {
  const state = { served: 0, closed: false }
  const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => [from + i])
  const fake: PgRowSource = {
    async cursor(size, fn) {
      let first = true
      while (state.served < total) {
        const batch = Object.assign(
          rows(state.served, Math.min(size, total - state.served)),
          first ? { columns } : {},
        )
        first = false
        state.served += batch.length
        if ((await fn(batch)) === CLOSE) {
          state.closed = true
          break
        }
      }
      return Object.assign([], total === 0 ? { columns } : {})
    },
    async forEach(fn) {
      const result = Object.assign([], { columns, count: total })
      for (let n = 0; n < total; n++) {
        state.served++
        fn([n], result)
      }
      return result
    },
  }
  return { fake, state }
}

describe('collectPgRows', () => {
  test('a single read uses the cursor: the server stops one row past the cap', async () => {
    const { fake, state } = source(RESULT_ROW_CAP * 5)
    const collected = await collectPgRows(fake, true, CLOSE)
    expect(collected.rows).toHaveLength(RESULT_ROW_CAP)
    expect(collected.truncated).toBe(true)
    expect(state).toEqual({ served: RESULT_ROW_CAP + 1, closed: true })
    // The first batch's columns survive onto the result the driver shapes.
    expect(shapePgValuesResult(collected.result, 0, collected).columns).toEqual(columns)
  })

  test('an empty read keeps its columns from the awaited result', async () => {
    const { fake } = source(0)
    const collected = await collectPgRows(fake, true, CLOSE)
    const shaped = shapePgValuesResult(collected.result, 0, collected)
    expect(shaped.columns).toEqual(columns)
    expect(shaped.rows).toEqual([])
    expect(shaped.truncated).toBeUndefined()
  })

  test('anything else drains to its end and keeps only the first rows', async () => {
    const { fake, state } = source(RESULT_ROW_CAP + 7)
    const collected = await collectPgRows(fake, false, CLOSE)
    expect(state.served).toBe(RESULT_ROW_CAP + 7)
    const shaped = shapePgValuesResult(collected.result, 0, collected)
    expect(shaped.rows).toHaveLength(RESULT_ROW_CAP)
    expect(shaped.truncated).toBe(true)
  })

  test('only the first result of a script is kept', async () => {
    const first = Object.assign([], { columns })
    const second = Object.assign([], { columns })
    const fake = {
      cursor: () => Promise.reject(new Error('unexpected cursor')),
      async forEach(fn: (row: unknown[], result: unknown) => void) {
        fn([1], first)
        fn([2], second)
        return first
      },
    } as unknown as PgRowSource
    expect((await collectPgRows(fake, false, CLOSE)).rows).toEqual([[1]])
  })
})
