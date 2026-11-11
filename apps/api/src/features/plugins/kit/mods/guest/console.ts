/**
 * The `console` a hooks module gets in its VM: each call becomes one line of text, formatted here
 * — a string as it is, anything else as JSON, never by a value's own inspect — and handed to
 * `print`, which sends it to the host. The host cuts each line and drops a flood (`mod-vm.ts`);
 * nothing measured here is trusted there.
 */

type Level = 'log' | 'error'

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

export function createGuestConsole(input: {
  print: (level: Level, line: string) => void
  now: () => number
}): Record<string, (...args: unknown[]) => void> {
  const write = (level: Level, args: readonly unknown[]) =>
    input.print(level, args.map(formatted).join(' '))
  const counts = new Map<string, number>()
  const timers = new Map<string, number>()
  // A console label is stringified the way the web console does it, whatever it is.
  // oxlint-disable-next-line typescript/no-base-to-string -- ToString semantics are the contract
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
