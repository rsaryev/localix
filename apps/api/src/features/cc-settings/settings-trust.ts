import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { isRecord } from '../../lib/record'
import { claudeStateFile } from './config-dir'
import { localSettingsRoot, type SettingsFilesInput } from './settings-files'

/**
 * Whether Claude Code trusts a folder: `projects["<root>"].hasTrustDialogAccepted` in its state
 * file (`~/.claude.json`, or inside `CLAUDE_CONFIG_DIR`), keyed on the repository root — a
 * worktree's main checkout — or, outside a repository, on the folder or a parent of it
 * (permissions.md, "Project allow rules and workspace trust"). What a committed project file
 * grants — allow rules, additional directories, its `env` — waits for this, as in Claude Code.
 */
export function claudeCodeTrusts(input: SettingsFilesInput & { cwd: string }): boolean {
  const trusted = trustedFolders(input.homeDir, input.env)
  const root = localSettingsRoot(input.cwd, input.homeDir, input.platform)
  if (root) return trusted(root)
  for (let dir = resolve(input.cwd); ; dir = dirname(dir)) {
    if (trusted(dir)) return true
    if (dirname(dir) === dir) return false
  }
}

/**
 * Whether the state file records the trust dialog accepted for exactly this key. A state file
 * that is missing or unreadable trusts nothing.
 */
export function trustedFolders(
  homeDir: string,
  env?: Record<string, string | undefined>,
): (key: string) => boolean {
  let projects: unknown
  try {
    const text = readFileSync(claudeStateFile(homeDir, env), 'utf8')
    projects = (JSON.parse(text) as { projects?: unknown }).projects
  } catch {
    return () => false
  }
  return (key) => {
    const entry = isRecord(projects) ? projects[key] : undefined
    return isRecord(entry) && entry.hasTrustDialogAccepted === true
  }
}
