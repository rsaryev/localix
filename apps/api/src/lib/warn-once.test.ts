import { describe, expect, test } from 'bun:test'
import { warnOnce, type WarnLogger } from './warn-once'

function recorder() {
  const lines: Array<{ level: 'warn' | 'debug'; entry: Record<string, unknown> }> = []
  const logger: WarnLogger = {
    warn: (entry) => lines.push({ level: 'warn', entry }),
    debug: (entry) => lines.push({ level: 'debug', entry }),
  }
  return { lines, logger }
}

describe('warnOnce', () => {
  test('warns the first time a cause is reported and demotes the repeats to debug', () => {
    const { lines, logger } = recorder()
    const warn = warnOnce(logger)
    const entry = { event: 'plugin_backend.warn', msg: 'inspect failed', meta: { error: 'ENOENT' } }
    for (let i = 0; i < 40; i += 1) warn(entry)
    expect(lines.filter((line) => line.level === 'warn')).toHaveLength(1)
    expect(lines.filter((line) => line.level === 'debug')).toHaveLength(39)
    expect(lines[1]?.entry.repeat).toBe(true)
  })

  test('a different message, event or error is a different cause and warns again', () => {
    const { lines, logger } = recorder()
    const warn = warnOnce(logger)
    warn({ event: 'a', msg: 'one', meta: { error: 'x' } })
    warn({ event: 'a', msg: 'two', meta: { error: 'x' } })
    warn({ event: 'b', msg: 'one', meta: { error: 'x' } })
    warn({ event: 'a', msg: 'one', meta: { error: 'y' } })
    expect(lines.map((line) => line.level)).toEqual(['warn', 'warn', 'warn', 'warn'])
  })

  test('copes with an entry that has no meta', () => {
    const { lines, logger } = recorder()
    const warn = warnOnce(logger)
    warn({ event: 'a', msg: 'no meta' })
    warn({ event: 'a', msg: 'no meta' })
    expect(lines.map((line) => line.level)).toEqual(['warn', 'debug'])
  })

  test('shares one set across loggers when given one, and keeps its own otherwise', () => {
    const shared = new Set<string>()
    const first = recorder()
    const second = recorder()
    const entry = { event: 'a', msg: 'same' }
    warnOnce(first.logger, shared)(entry)
    warnOnce(second.logger, shared)(entry)
    expect(second.lines[0]?.level).toBe('debug')
    const third = recorder()
    warnOnce(third.logger)(entry)
    expect(third.lines[0]?.level).toBe('warn')
  })
})
