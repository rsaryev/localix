import { describe, expect, spyOn, test } from 'bun:test'
import { Writable } from 'node:stream'

import { captureConsoleDiagnostics, createLogger } from './logger'

/** A destination that keeps every line it is given. */
function capture() {
  const lines: Record<string, unknown>[] = []
  const stream = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line))
      done()
    },
  })
  return { lines, stream }
}

// The shell's desktop.log and this log merge into one timeline only if both carry the same
// fields; before, nothing tied an API line to the launch it belonged to.
describe('createLogger fields', () => {
  test('every line says it is the API, and which launch it belongs to', () => {
    const sink = capture()
    createLogger('info', sink.stream as never, { launch: 'lx9-abc' }).info({ event: 'boot' })
    expect(sink.lines[0]).toMatchObject({ source: 'api', launch: 'lx9-abc', event: 'boot' })
    // A log a user attaches to a report has no use for their machine's name.
    expect(sink.lines[0]).not.toHaveProperty('hostname')
  })

  test('without a launch there is no launch field, not an empty one', () => {
    const sink = capture()
    createLogger('info', sink.stream as never).info({ event: 'boot' })
    expect(sink.lines[0]).not.toHaveProperty('launch')
  })

  test('the development tee writes the file and the terminal', () => {
    const sink = capture()
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      createLogger('info', sink.stream as never, { teeStdout: true }).info({ event: 'tee' })
      expect(sink.lines.map((line) => line.event)).toEqual(['tee'])
      expect(stdout.mock.calls.some(([chunk]) => String(chunk).includes('"event":"tee"'))).toBe(
        true,
      )
    } finally {
      stdout.mockRestore()
    }
  })
})

const METHODS = ['debug', 'info', 'log', 'warn', 'error'] as const

describe('captureConsoleDiagnostics', () => {
  test('routes direct console output to structured diagnostics and restores ownership safely', () => {
    const originalCalls: string[] = []
    const recordOriginal =
      (method: (typeof METHODS)[number]) =>
      (...data: unknown[]): void => {
        originalCalls.push(`${method}:${data.map(String).join(',')}`)
      }
    const target = {
      debug: recordOriginal('debug'),
      info: recordOriginal('info'),
      log: recordOriginal('log'),
      warn: recordOriginal('warn'),
      error: recordOriginal('error'),
    }
    const diagnostics: Array<{ level: string; value: object }> = []
    const recordDiagnostic =
      (level: string) =>
      (value: object): void => {
        diagnostics.push({ level, value })
      }
    const logger = {
      debug: recordDiagnostic('debug'),
      info: recordDiagnostic('info'),
      warn: recordDiagnostic('warn'),
      error: recordDiagnostic('error'),
    }
    const originalWarn = target.warn

    const restore = captureConsoleDiagnostics(logger, target)
    target.log('boot', { ready: true })
    target.warn('duplicate', 2)
    expect(originalCalls).toEqual([])
    expect(diagnostics).toEqual([
      {
        level: 'info',
        value: { event: 'console.log', msg: 'boot { ready: true }' },
      },
      { level: 'warn', value: { event: 'console.warn', msg: 'duplicate 2' } },
    ])

    restore()
    restore()
    expect(target.warn).toBe(originalWarn)
    target.warn('visible again')
    expect(originalCalls).toEqual(['warn:visible again'])
  })

  test('does not overwrite a later console owner while restoring', () => {
    const noop = (..._data: unknown[]) => {}
    const target = {
      debug: noop,
      info: noop,
      log: noop,
      warn: noop,
      error: noop,
    }
    const logger = { debug: noop, info: noop, warn: noop, error: noop }
    const restore = captureConsoleDiagnostics(logger, target)
    const laterOwner = () => {}
    target.warn = laterOwner
    restore()
    expect(target.warn).toBe(laterOwner)
  })

  test('redacts structured message bodies before console formatting erases field semantics', () => {
    const noop = (..._data: unknown[]) => {}
    const target = {
      debug: noop,
      info: noop,
      log: noop,
      warn: noop,
      error: noop,
    }
    const diagnostics: object[] = []
    const record = (value: object): void => {
      diagnostics.push(value)
    }
    const restore = captureConsoleDiagnostics(
      { debug: record, info: record, warn: record, error: record },
      target,
    )

    target.warn('provider failed', {
      prompt: 'private natural-language request',
      accessToken: 'opaque-oauth-value',
      reason: 'connection reset',
    })
    restore()

    const line = JSON.stringify(diagnostics)
    expect(line).not.toContain('private natural-language request')
    expect(line).not.toContain('opaque-oauth-value')
    expect(line).toContain('connection reset')
    expect(line).toContain('[redacted]')
  })

  test('captures foreign Errors without their stack or token-bearing details', () => {
    const noop = (..._data: unknown[]) => {}
    const target = {
      debug: noop,
      info: noop,
      log: noop,
      warn: noop,
      error: noop,
    }
    const diagnostics: object[] = []
    const record = (value: object): void => {
      diagnostics.push(value)
    }
    const restore = captureConsoleDiagnostics(
      { debug: record, info: record, warn: record, error: record },
      target,
    )
    const error = new Error('OAuth failed for bearer abcdefghijklmno')
    error.stack = 'PRIVATE_STACK_BODY\n' + error.stack
    target.error(error)
    restore()

    const line = JSON.stringify(diagnostics)
    expect(line).not.toContain('abcdefghijklmno')
    expect(line).not.toContain('PRIVATE_STACK_BODY')
    expect(line).toContain('[redacted]')
    expect(line).toContain('OAuth failed')
  })
})
