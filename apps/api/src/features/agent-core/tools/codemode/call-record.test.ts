import { describe, expect, test } from 'bun:test'

import { CALL_RECORD_LIMITS, createCallRecord } from './call-record'

describe('the codemode call record', () => {
  test('keeps each call with its input, outcome and a whole-millisecond time', () => {
    const record = createCallRecord()
    record.start('read', { path: 'a.ts' })({})
    record.start('bash', { command: 'false' })({ error: 'x'.repeat(900) })
    const { calls, complete } = record.snapshot()
    expect(complete).toBe(true)
    expect(calls[0]).toMatchObject({ name: 'read', args: { path: 'a.ts' }, status: 'ok' })
    expect(Number.isInteger(calls[0]!.durationMs)).toBe(true)
    expect(calls[1]!.status).toBe('error')
    expect(calls[1]!.error).toHaveLength(CALL_RECORD_LIMITS.maxErrorChars)
  })

  test('a call still running when the script ended reads as cancelled', () => {
    const record = createCallRecord()
    record.start('bash', { command: 'sleep 9' })
    expect(record.snapshot().calls[0]).toMatchObject({ status: 'cancelled' })
    expect(record.snapshot().calls[0]!.durationMs).toBeUndefined()
  })

  test('leaves out what is over the limits, and says so', () => {
    const big = createCallRecord()
    big.start('write', { content: 'x'.repeat(CALL_RECORD_LIMITS.maxArgumentBytesPerCall) })({})
    expect(big.snapshot()).toMatchObject({
      calls: [{ name: 'write', status: 'ok' }],
      complete: false,
    })
    expect(big.snapshot().calls[0]!.args).toBeUndefined()

    const many = createCallRecord()
    for (let i = 0; i <= CALL_RECORD_LIMITS.maxCalls; i += 1) many.start('read', { i })({})
    expect(many.snapshot().calls).toHaveLength(CALL_RECORD_LIMITS.maxCalls)
    expect(many.snapshot().complete).toBe(false)
  })
})
