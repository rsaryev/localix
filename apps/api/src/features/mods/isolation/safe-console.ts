import { createRateLimit, truncated } from './rate-limit'

/**
 * The `console` a hooks module gets in its worker. It hands Bun's console one string per call,
 * formatted here: Bun's own formatting would call the module's `inspect.custom` with Bun's
 * `inspect` and its options, and a module's flood of lines would fill Localix's log. Each line is
 * cut to `LINE_CHARS`, and past `LINES` lines in `WINDOW_MS` the rest of the window is dropped.
 */

const LINE_CHARS = 4_000
const LINES = 200
const WINDOW_MS = 10_000

type Level = 'log' | 'error'
type Print = (level: Level, line: string) => void

export function createSafeConsole(input: {
  print: Print
  now: () => number
  limits?: { lineChars: number; lines: number; windowMs: number }
}): Record<string, (...args: unknown[]) => void> {
  const limits = input.limits ?? { lineChars: LINE_CHARS, lines: LINES, windowMs: WINDOW_MS }
  const rate = createRateLimit({ max: limits.lines, windowMs: limits.windowMs, now: input.now })
  const write = (level: Level, args: readonly unknown[]) => {
    const verdict = rate.take()
    if (verdict === 'drop') return
    if (verdict === 'first-drop')
      return input.print('error', `[mod] console: more than ${limits.lines} lines; some dropped`)
    input.print(level, truncated(args.map(formatted).join(' '), limits.lineChars))
  }
  const counts = new Map<string, number>()
  const timers = new Map<string, number>()
  const label = (name: unknown) => (name === undefined ? 'default' : String(name))
  const elapsed = (name: unknown) => {
    const started = timers.get(label(name))
    return started === undefined ? 'no such timer' : `${input.now() - started}ms`
  }
  const log = (...args: unknown[]) => write('log', args)
  const error = (...args: unknown[]) => write('error', args)
  return {
    log,
    info: log,
    debug: log,
    dir: (value: unknown) => write('log', [value]),
    table: (value: unknown) => write('log', [value]),
    warn: error,
    error,
    trace: error,
    assert: (condition: unknown, ...args: unknown[]) =>
      condition ? undefined : write('error', ['Assertion failed', ...args]),
    count(name?: unknown) {
      const count = (counts.get(label(name)) ?? 0) + 1
      counts.set(label(name), count)
      write('log', [`${label(name)}: ${count}`])
    },
    countReset: (name?: unknown) => void counts.delete(label(name)),
    group: log,
    groupCollapsed: log,
    groupEnd: () => {},
    time: (name?: unknown) => void timers.set(label(name), input.now()),
    timeLog: (name?: unknown, ...args: unknown[]) =>
      write('log', [`${label(name)}: ${elapsed(name)}`, ...args]),
    timeEnd(name?: unknown) {
      write('log', [`${label(name)}: ${elapsed(name)}`])
      timers.delete(label(name))
    },
  }
}

/** One argument as text: a string as it is, anything else as JSON, never by its own inspect. */
export function formatted(value: unknown): string {
  try {
    if (typeof value === 'string') return value
    if (value instanceof Error) return `${value.name}: ${value.message}`
    if (typeof value !== 'object' || value === null) return describe(value)
    const seen = new WeakSet<object>()
    return JSON.stringify(value, (_key, field: unknown) => {
      if (field instanceof Error) return `${field.name}: ${field.message}`
      if (typeof field === 'object' && field !== null) {
        if (seen.has(field)) return '[Circular]'
        seen.add(field)
        return field
      }
      const kind = typeof field
      return kind === 'function' || kind === 'bigint' || kind === 'symbol' ? describe(field) : field
    })
  } catch {
    return '[unprintable]'
  }
}

function describe(value: unknown): string {
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (typeof value === 'bigint') return `${value}n`
  return typeof value === 'string' ? value : String(value)
}
