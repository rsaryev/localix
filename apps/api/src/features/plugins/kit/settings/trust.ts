import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { workspaceTrustKey } from '@rsaryev/llx-plugin/loading'
import { isRecord } from '../../../../lib/record'
import { claudeStateFile } from '../../../cc-settings/config-dir'
import { folderRepository, type FolderRepository } from './repository'

/**
 * Whether Claude Code trusts a folder. Localix keeps no trust of its own: it reads Claude Code's
 * state file (`~/.claude.json`, or inside `CLAUDE_CONFIG_DIR`) at each question, so a dialog
 * accepted in Claude Code counts here at once. The kit names the key (`workspaceTrustKey`: a
 * repository's main checkout root, else the folder); outside a repository a trusted parent folder
 * counts too, as Claude Code's dialog does not ask again below one.
 */

/** Whether the state file records the trust dialog accepted for exactly this key; a missing or unreadable file trusts nothing. */
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

export interface FolderTrustFacts {
  homeDir: string
  cwd: string
  env?: Record<string, string | undefined>
  repository: FolderRepository | undefined
}

export function folderTrusted(facts: FolderTrustFacts): boolean {
  const trusted = trustedFolders(facts.homeDir, facts.env)
  const { key } = workspaceTrustKey({
    startDir: resolve(facts.cwd),
    homeDir: facts.homeDir,
    ...(facts.repository ? { mainCheckoutRoot: facts.repository.root } : {}),
  })
  if (trusted(key)) return true
  if (facts.repository) return false
  for (let dir = dirname(key); ; dir = dirname(dir)) {
    if (trusted(dir)) return true
    if (dirname(dir) === dir) return false
  }
}

/** Whether Claude Code trusts the folder, its repository read from the disk. */
export const claudeCodeTrusts = (input: Omit<FolderTrustFacts, 'repository'>): boolean =>
  folderTrusted({ ...input, repository: folderRepository(input.cwd) })
