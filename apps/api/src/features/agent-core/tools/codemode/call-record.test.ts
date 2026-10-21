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

  test('shortens a large input instead of dropping it, so a write still names its file', () => {
    const big = createCallRecord()
    const content = 'x'.repeat(CALL_RECORD_LIMITS.maxArgumentBytesPerCall)
    big.start('write', { path: 'src/big.ts', content })({})
    const [call] = big.snapshot().calls
    expect(call).toMatchObject({ name: 'write', status: 'ok', args: { path: 'src/big.ts' } })
    expect((call!.args as { content: string }).content).toStartWith(
      'x'.repeat(CALL_RECORD_LIMITS.maxStringChars),
    )
    expect((call!.args as { content: string }).content).toEndWith('more characters)')
    expect(big.snapshot().complete).toBe(true)
  })

  test('past the total size it keeps each call target, so later commands stay visible', () => {
    const record = createCallRecord()
    const padding = Array.from({ length: 40 }, (_, i) => `field-${i}`)
    const wide = Object.fromEntries(padding.map((key) => [key, 'y'.repeat(250)]))
    for (let i = 0; i < 10; i += 1) record.start('read', { path: `pad-${i}.ts`, ...wide })({})
    record.start('bash', { command: 'rm -rf build', ...wide })({})
    const { calls, complete } = record.snapshot()
    expect(complete).toBe(false)
    expect(calls.at(-1)).toMatchObject({ name: 'bash', args: { command: 'rm -rf build' } })
    expect(calls.every((call) => call.args !== undefined)).toBe(true)
  })

  test('past the call count it counts the calls it left out', () => {
    const many = createCallRecord()
    for (let i = 0; i < CALL_RECORD_LIMITS.maxCalls + 3; i += 1) many.start('read', { i })({})
    expect(many.snapshot().calls).toHaveLength(CALL_RECORD_LIMITS.maxCalls)
    expect(many.snapshot()).toMatchObject({ complete: false, omittedCalls: 3 })
  })
})
