/**
 * Log a warning once per distinct cause, and the repeats quietly.
 *
 * A plugin that cannot load is reported again by every pass that reaches it: one launch of a
 * workspace with two broken plugins wrote forty near-identical `plugin_backend.warn` lines, which
 * buried the one line that said what was wrong and made a healthy start read as a noisy one. The
 * first report of a cause stays a warning; the same cause again goes to `debug`, still on record
 * when a log level is turned up, never lost.
 */
export interface WarnLogger {
  warn(entry: Record<string, unknown>): void
  debug(entry: Record<string, unknown>): void
}

/** The cause a warning reports: the event, its message and the error it carries, if any. */
function causeOf(entry: Record<string, unknown>): string {
  const meta = entry.meta as { error?: unknown } | undefined
  const text = (part: unknown) => (typeof part === 'string' ? part : (JSON.stringify(part) ?? ''))
  return [entry.event, entry.msg, meta?.error].map(text).join('|')
}

/** The causes already warned about by plugin loading, shared by every site that reports them. */
export const PLUGIN_WARNINGS = new Set<string>()

/** A logger that warns once per cause (`seen` is per process unless one is passed in). */
export function warnOnce(logger: WarnLogger, seen: Set<string> = new Set()): WarnLogger['warn'] {
  return (entry) => {
    const cause = causeOf(entry)
    if (seen.has(cause)) {
      logger.debug({ ...entry, repeat: true })
      return
    }
    seen.add(cause)
    logger.warn(entry)
  }
}
