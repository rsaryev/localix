import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { isRecord } from '../../lib/record'

/**
 * `/add-dir`: remember a further working directory the way Claude Code's "remember" choice does,
 * in the project's `.claude/settings.local.json` under `permissions.additionalDirectories`. The
 * permission gate reads that key from every settings layer (`settings-permissions.ts`), so the
 * folder is judged like the project from the next run on. The file is Claude Code's own, so
 * nothing else in it is touched, and one that is not valid JSON is left alone.
 */
export type AddDirectoryResult =
  | { status: 'added' | 'present'; file: string }
  | { status: 'unreadable'; file: string }

export function addAdditionalDirectory(input: {
  cwd: string
  /** An absolute path. */
  directory: string
}): AddDirectoryResult {
  const file = join(input.cwd, '.claude', 'settings.local.json')
  let settings: Record<string, unknown> = {}
  let text: string | undefined
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    text = undefined
  }
  if (text !== undefined) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (!isRecord(parsed)) return { status: 'unreadable', file }
      settings = parsed
    } catch {
      return { status: 'unreadable', file }
    }
  }
  const permissions = isRecord(settings.permissions) ? settings.permissions : {}
  const listed = Array.isArray(permissions.additionalDirectories)
    ? permissions.additionalDirectories
    : []
  if (listed.includes(input.directory)) return { status: 'present', file }
  const next = {
    ...settings,
    permissions: { ...permissions, additionalDirectories: [...listed, input.directory] },
  }
  mkdirSync(join(input.cwd, '.claude'), { recursive: true })
  // Written beside and renamed over, so a crash never leaves half a settings file.
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`)
  renameSync(temporary, file)
  return { status: 'added', file }
}
