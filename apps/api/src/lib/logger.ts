import pino from 'pino'
import { format } from 'node:util'

import { redactDeep, sanitizeLogString } from './secret-redaction'

export type Logger = pino.Logger
export type LogLevel = pino.Level

export interface LoggerFields {
  /** The desktop launch this process belongs to (`LOCALIX_LAUNCH_ID`, set by the shell). */
  launch?: string
  /**
   * Also write to stdout when logging to a file — development, where the terminal is where a
   * person watches and the file is what `bun run logs` merges with the other processes.
   */
  teeStdout?: boolean
}

/**
 * Every line carries `source: 'api'` and, when the desktop shell started this runtime, its
 * `launch` id: the fields the shell's `desktop.log` carries too, so the two files merge into
 * one timeline per launch (`scripts/logs.mjs`). `hostname` is dropped from pino's defaults —
 * a log a user attaches to a report has no use for their machine's name.
 */
export function createLogger(
  level: LogLevel,
  destination?: pino.DestinationStream,
  fields: LoggerFields = {},
): Logger {
  const options: pino.LoggerOptions = {
    level,
    base: { pid: process.pid, source: 'api', ...(fields.launch ? { launch: fields.launch } : {}) },
    serializers: {
      // Errors bypass the logMethod object-scrub (left to pino's serializer), so
      // redact their message/stack here — auth failures often embed a token.
      err: (e: unknown) => {
        const s = pino.stdSerializers.err(e as Error)
        return {
          ...s,
          message: typeof s.message === 'string' ? sanitizeLogString(s.message) : s.message,
          stack: typeof s.stack === 'string' ? sanitizeLogString(s.stack) : s.stack,
        }
      },
    },
    hooks: {
      // Scrub secret-shaped tokens from messages + plain metadata before write, so
      // a leaked key never lands on stdout/disk. Errors are handled by serializers.err.
      logMethod(inputArgs, method) {
        const scrubbed = (inputArgs as unknown[]).map((arg) =>
          typeof arg === 'string'
            ? sanitizeLogString(arg)
            : arg && typeof arg === 'object' && !(arg instanceof Error)
              ? redactDeep(arg)
              : arg,
        )
        return method.apply(this, scrubbed as Parameters<typeof method>)
      },
    },
  }
  if (!destination) return pino(options)
  if (!fields.teeStdout) return pino(options, destination)
  return pino(
    options,
    pino.multistream([
      { level, stream: destination },
      { level, stream: process.stdout },
    ]),
  )
}

type ConsoleMethod = 'debug' | 'info' | 'log' | 'warn' | 'error'
type ConsoleTarget = Record<ConsoleMethod, (...data: unknown[]) => void>
type DiagnosticLogger = Record<'debug' | 'info' | 'warn' | 'error', (value: object) => void>

function safeConsoleArgument(arg: unknown): unknown {
  if (arg instanceof Error) {
    // A dependency stack can include request URLs, source-line literals, and an
    // arbitrarily large cause graph. The structured API logger already records
    // owned Errors with its redacting serializer; for foreign console calls keep
    // only bounded, scrubbed diagnostic identity.
    const code = (arg as Error & { code?: unknown }).code
    return {
      name: sanitizeLogString(arg.name),
      message: sanitizeLogString(arg.message),
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    }
  }
  return arg && typeof arg === 'object' ? redactDeep(arg) : arg
}

/** Route direct library console calls through the structured runtime logger. */
export function captureConsoleDiagnostics(
  logger: DiagnosticLogger,
  target: ConsoleTarget = console,
): () => void {
  const originals = new Map<ConsoleMethod, (...data: unknown[]) => void>()
  const replacements = new Map<ConsoleMethod, (...data: unknown[]) => void>()
  for (const method of ['debug', 'info', 'log', 'warn', 'error'] as const) {
    originals.set(method, target[method])
    const level = method === 'log' ? 'info' : method
    const replacement = (...data: unknown[]): void => {
      // Redact objects BEFORE util.format flattens their field names into a string;
      // otherwise `{ input: 'ordinary private text' }` is no longer distinguishable
      // from a useful diagnostic sentence by the logger hook.
      const safeData = data.map(safeConsoleArgument)
      logger[level]({
        event: `console.${method}`,
        msg: sanitizeLogString(format(...safeData)),
      })
    }
    replacements.set(method, replacement)
    target[method] = replacement
  }

  let restored = false
  return () => {
    if (restored) return
    restored = true
    for (const method of ['debug', 'info', 'log', 'warn', 'error'] as const) {
      if (target[method] === replacements.get(method)) target[method] = originals.get(method)!
    }
  }
}
