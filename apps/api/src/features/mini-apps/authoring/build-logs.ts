import { relative } from 'node:path'

/**
 * A failed bundle's logs as `file:line:col message` lines, relative to the mini app.
 *
 * `String(log)` / `log.message` dropped the location, so "Could not resolve: zod" arrived without
 * the file that imported it and the agent had to search for it. Bun's `BuildMessage` and
 * `ResolveMessage` both carry `position`; that is the whole formatter.
 */
export function formatBuildLogs(logs: readonly unknown[], miniAppDir: string): string {
  return logs
    .map((log) => {
      const entry = log as {
        message?: string
        position?: { file?: string; line?: number; column?: number } | null
      }
      const position = entry.position
      const at = position?.file
        ? `${relative(miniAppDir, position.file)}${position.line ? `:${position.line}:${position.column ?? 0}` : ''} `
        : ''
      return `${at}${entry.message ?? String(log)}`
    })
    .join('\n')
}
