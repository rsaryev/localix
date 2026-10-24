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
  let projects: unknown
  try {
    const text = readFileSync(claudeStateFile(input.homeDir, input.env), 'utf8')
    projects = (JSON.parse(text) as { projects?: unknown }).projects
  } catch {
    return false
  }
  if (!isRecord(projects)) return false
  const trusted = (dir: string) => {
    const entry = projects[dir]
    return isRecord(entry) && entry.hasTrustDialogAccepted === true
  }
  const root = localSettingsRoot(input.cwd, input.homeDir, input.platform)
  if (root) return trusted(root)
  for (let dir = resolve(input.cwd); ; dir = dirname(dir)) {
    if (trusted(dir)) return true
    if (dirname(dir) === dir) return false
  }
}
