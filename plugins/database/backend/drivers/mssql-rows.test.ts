/**
 * The SQL Server row cap at the mssql stream seam. The fake plays a Request in stream mode:
 * `recordset` (columns), `row` per row until cancelled, then `error` (on cancel) and `done`.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'bun:test'
import { RESULT_ROW_CAP } from '../../shared/result-cap'
import { streamMssqlRows, type MssqlStreamingRequest } from './mssql-rows'

function request(
  play: (emit: (event: string, ...args: unknown[]) => boolean, state: State) => void,
) {
  const state: State = { sent: 0, cancelled: false, stream: false }
  const emitter = new EventEmitter()
  const req = Object.assign(emitter, {
    stream: false,
    query() {
      state.stream = req.stream
      queueMicrotask(() => play((event, ...args) => emitter.emit(event, ...args), state))
    },
    cancel() {
      state.cancelled = true
    },
  })
  return { req: req as unknown as MssqlStreamingRequest, state }
}
interface State {
  sent: number
  cancelled: boolean
  stream: boolean
}

const rows = (count: number) => (emit: (e: string, ...a: unknown[]) => boolean, state: State) => {
  emit('recordset', [{ name: 'n' }])
  for (let n = 0; n < count && !state.cancelled; n++) {
    state.sent++
    emit('row', [n])
  }
  if (state.cancelled) emit('error', new Error('Canceled.'))
  emit('done')
}

describe('streamMssqlRows', () => {
  test('a standalone read is cancelled one row past the cap, in stream mode', async () => {
    const { req, state } = request(rows(RESULT_ROW_CAP * 4))
    const collected = await streamMssqlRows(req, 'SELECT n FROM big', true)
    expect(collected.rows).toHaveLength(RESULT_ROW_CAP)
    expect(collected.truncated).toBe(true)
    expect(state).toEqual({ sent: RESULT_ROW_CAP + 1, cancelled: true, stream: true })
  })

  test('a write or a transaction statement drains instead of being cancelled', async () => {
    const { req, state } = request(rows(RESULT_ROW_CAP + 9))
    const collected = await streamMssqlRows(req, 'INSERT … OUTPUT', false)
    expect(collected.rows).toHaveLength(RESULT_ROW_CAP)
    expect(collected.truncated).toBe(true)
    expect(state.sent).toBe(RESULT_ROW_CAP + 9)
    expect(state.cancelled).toBe(false)
  })

  test('only the first recordset is kept; a DML batch reports its counts', async () => {
    const { req } = request((emit) => {
      emit('recordset', [{ name: 'a' }])
      emit('row', [1])
      emit('recordset', [{ name: 'b' }])
      emit('row', [2])
      emit('done')
    })
    expect(await streamMssqlRows(req, 'SELECT 1; SELECT 2', true)).toEqual({
      columns: [{ name: 'a' }],
      rows: [[1]],
      rowsAffected: 0,
      truncated: false,
    })
    const dml = request((emit) => {
      emit('rowsaffected', 2)
      emit('rowsaffected', 3)
      emit('done')
    })
    expect(await streamMssqlRows(dml.req, 'UPDATE t SET a = 1', false)).toEqual({
      rows: [],
      rowsAffected: 5,
      truncated: false,
    })
  })

  test('a real error still rejects', async () => {
    const { req } = request((emit) => {
      emit('error', new Error('Invalid object name'))
      emit('done')
    })
    expect(streamMssqlRows(req, 'SELECT * FROM nope', true)).rejects.toThrow('Invalid object name')
  })
})
