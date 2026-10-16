export type LogSeverity = 'error' | 'warning' | 'info' | 'debug' | 'plain'
export type LogTokenKind =
  | 'plain'
  | 'key'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'error'
  | 'warning'
  | 'info'
  | 'debug'
  | 'method'
  | 'status-success'
  | 'status-warning'
  | 'status-error'

export interface LogToken {
  key: string
  text: string
  kind: LogTokenKind
}

export const ALL_LOG_SEVERITIES = [
  'error',
  'warning',
  'info',
  'debug',
  'plain',
] as const satisfies readonly LogSeverity[]

export interface LogLine {
  /** Stable React identity for timestamped runtime lines; occurrence suffix keeps
   * exact duplicate messages valid without duplicate DOM keys. */
  key: string
  /** Stable within the current bounded tail snapshot. */
  index: number
  raw: string
  /** Full RFC3339 timestamp for copy/title, when the runtime supplied one. */
  timestamp?: string
  /** Compact time-of-day shown in the gutter. */
  timeLabel?: string
  message: string
  /** ANSI-free text rendered in the browser; `raw` remains lossless for copy/download. */
  display: string
  /** Lightweight console tokens, computed once with the bounded tail snapshot. */
  tokens: LogToken[]
  severity: LogSeverity
}

const RFC3339_PREFIX =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s(.*)$/
const TIME_PART = /T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?/
const STRUCTURED_LEVEL =
  /"(?:level|severity|logLevel)"\s*:\s*"(fatal|panic|error|err|warn|warning|info|debug|trace)"/i
// oxlint-disable-next-line no-control-regex -- terminal escape sequences are formatting, never visible log data
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g
const JSON_TOKEN_RE =
  /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false)\b|\bnull\b/g
const CONSOLE_TOKEN_RE =
  /\b(?:fatal|panic|error|err|warn|warning|info|debug|trace)\b|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|\b[1-5]\d{2}\b|https?:\/\/[^\s]+/gi

const token = (text: string, kind: LogTokenKind, start: number): LogToken => ({
  key: `${start}:${kind}`,
  text,
  kind,
})

function tokenKind(value: string, json: boolean, isKey = false): LogTokenKind {
  if (isKey) return 'key'
  if (json) {
    if (value.startsWith('"')) return 'string'
    if (value === 'true' || value === 'false') return 'boolean'
    if (value === 'null') return 'null'
    return 'number'
  }
  const normalized = value.toLowerCase()
  if (['fatal', 'panic', 'error', 'err'].includes(normalized)) return 'error'
  if (normalized === 'warn' || normalized === 'warning') return 'warning'
  if (normalized === 'info' || normalized === 'notice') return 'info'
  if (normalized === 'debug' || normalized === 'trace') return 'debug'
  if (/^(get|post|put|patch|delete|head|options)$/i.test(value)) return 'method'
  if (/^[1-5]\d{2}$/.test(value)) {
    const status = Number(value)
    return status >= 500 ? 'status-error' : status >= 400 ? 'status-warning' : 'status-success'
  }
  return 'info'
}

function tokenizeWith(text: string, expression: RegExp, json: boolean): LogToken[] {
  const tokens: LogToken[] = []
  expression.lastIndex = 0
  let last = 0
  let match: RegExpExecArray | null
  while ((match = expression.exec(text))) {
    if (match.index > last) tokens.push(token(text.slice(last, match.index), 'plain', last))
    const value = match[0]
    const isKey =
      json && value.startsWith('"') && /^\s*:/.test(text.slice(match.index + value.length))
    tokens.push(token(value, tokenKind(value, json, isKey), match.index))
    last = match.index + value.length
  }
  if (last < text.length) tokens.push(token(text.slice(last), 'plain', last))
  return tokens
}

export function stripLogAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

export function tokenizeLogMessage(value: string): LogToken[] {
  const display = stripLogAnsi(value)
  const trimmed = display.trim()
  const structured = trimmed.startsWith('{') || trimmed.startsWith('[')
  return tokenizeWith(display, structured ? JSON_TOKEN_RE : CONSOLE_TOKEN_RE, structured)
}

function compactTime(timestamp: string): string {
  const match = TIME_PART.exec(timestamp)
  if (!match) return timestamp
  const milliseconds = match[2]?.slice(0, 3).padEnd(3, '0')
  return milliseconds ? `${match[1]}.${milliseconds}` : match[1]!
}

function severityFromLevel(level: string): LogSeverity {
  const normalized = level.toLowerCase()
  if (
    normalized === 'fatal' ||
    normalized === 'panic' ||
    normalized === 'error' ||
    normalized === 'err'
  ) {
    return 'error'
  }
  if (normalized === 'warn' || normalized === 'warning') return 'warning'
  if (normalized === 'info' || normalized === 'notice') return 'info'
  return 'debug'
}

/** `level=warn` / `severity="error"` — logfmt and key=value loggers. */
const KEYED_LEVEL =
  /\b(?:level|lvl|severity)=["']?(fatal|panic|error|err|warn|warning|info|notice|debug|trace|verbose)\b/i
/**
 * A level token in the line's level slot: first, optionally after a timestamp, optionally
 * bracketed (`ERROR …`, `[warn] …`, `2026/07/24 10:20:30 [error] …`, `panic: …`). A level word
 * anywhere else is message text — "0 errors", "retry failed, will retry" — and is not a level.
 */
const LEADING_LEVEL =
  /^[\d\-/:.,TZ+ ]*[[(<]?(fatal|panic|error|err|warn|warning|info|notice|debug|trace|verbose)\b[\])>]?(?=[:\s]|$)/i

/** The line's declared level — structured field, key=value or leading token — never its prose. */
export function detectLogSeverity(message: string): LogSeverity {
  const level =
    STRUCTURED_LEVEL.exec(message)?.[1] ??
    KEYED_LEVEL.exec(message)?.[1] ??
    LEADING_LEVEL.exec(message)?.[1]
  return level ? severityFromLevel(level) : 'plain'
}

/** Parse the bounded runtime tail without changing its copyable message text. */
export function parseLogLines(value: string): LogLine[] {
  if (!value) return []
  const source = value.endsWith('\n') ? value.slice(0, -1) : value
  if (!source) return []

  const occurrences = new Map<string, number>()
  return source.split(/\r?\n/).map((raw, index) => {
    const timestampMatch = RFC3339_PREFIX.exec(raw)
    const timestamp = timestampMatch?.[1]
    const message = timestampMatch?.[2] ?? raw
    const display = stripLogAnsi(message)
    const occurrence = occurrences.get(raw) ?? 0
    occurrences.set(raw, occurrence + 1)
    return {
      key: `${raw}\u0000${occurrence}`,
      index: index + 1,
      raw,
      timestamp,
      timeLabel: timestamp ? compactTime(timestamp) : undefined,
      message,
      display,
      tokens: tokenizeLogMessage(display),
      severity: detectLogSeverity(display),
    }
  })
}

export function filterLogLines(
  lines: readonly LogLine[],
  query: string,
  severities: readonly LogSeverity[] = ALL_LOG_SEVERITIES,
): LogLine[] {
  const needle = query.trim().toLocaleLowerCase()
  const visibleSeverities = new Set(severities)
  return lines.filter(
    (line) =>
      visibleSeverities.has(line.severity) &&
      (!needle || line.raw.toLocaleLowerCase().includes(needle)),
  )
}

export function isLogViewportNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 32,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}
