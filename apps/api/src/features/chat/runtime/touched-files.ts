import { isAbsolute, resolve } from 'node:path'
import type { PersistedMessage } from '../contracts'

/**
 * The files a session has worked with: every path its file tools read, wrote or edited, as an
 * absolute path, in first-touched order. Claude Code loads a subdirectory's CLAUDE.md, a
 * path-scoped rule and a `paths:` skill when Claude works with a matching file; Localix reads the
 * same fact from the session's history, so nothing extra is stored and a rebuilt run agrees.
 */
const FILE_TOOLS = new Set(['read', 'write', 'edit'])

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function pathsOfInput(input: unknown, out: string[]): void {
  if (!isRecord(input)) return
  for (const key of ['path', 'file_path']) {
    if (typeof input[key] === 'string') out.push(input[key] as string)
  }
  for (const key of ['paths', 'files', 'edits']) {
    const list = input[key]
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (typeof entry === 'string') out.push(entry)
      else pathsOfInput(entry, out)
    }
  }
}

export function touchedFilesOf(history: readonly PersistedMessage[], cwd: string): string[] {
  const raw: string[] = []
  for (const message of history) {
    for (const item of (message.payload.items ?? []) as unknown[]) {
      if (!isRecord(item)) continue
      if (item.type === 'file_change' && Array.isArray(item.changes)) {
        for (const change of item.changes)
          if (isRecord(change) && typeof change.path === 'string') raw.push(change.path)
        continue
      }
      if (typeof item.name === 'string' && FILE_TOOLS.has(item.name)) pathsOfInput(item.input, raw)
    }
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const path of raw) {
    const abs = isAbsolute(path) ? path : resolve(cwd, path)
    if (!seen.has(abs)) {
      seen.add(abs)
      out.push(abs)
    }
  }
  return out
}
