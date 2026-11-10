import { lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  permissionRuleLists,
  type PermissionRuleLists,
  type PolicyScope,
} from '@rsaryev/llx-plugin/settings'
import type { ClaudeSettings, SettingsFile } from './read'

/**
 * Which `permissions` rules and `additionalDirectories` of the settings files are in force, as the
 * kit decides it (`permissionRuleLists`: `allowManagedPermissionRulesOnly`, a committed project's
 * allow rules and directories waiting for the folder's trust, one entry for a rule several files
 * write). Each rule stays as written; the kit reads and matches it (`../permissions.ts`).
 */
export interface SettingsRuleEntry {
  effect: 'allow' | 'ask' | 'deny'
  /** As written: `Bash(git push *)`. */
  raw: string
  /** The settings file it came from (the highest of its scope), and where its `/path` anchors. */
  file: string
  sourceDir: string
  /** The settings scope that wrote it, which decides where the kit anchors its `/path`. */
  scope: PolicyScope
}

const EFFECTS = ['deny', 'ask', 'allow'] as const

function listsOf(settings: ClaudeSettings): PermissionRuleLists {
  const cwd = settings.input.cwd
  const claudeDir = cwd ? join(resolve(cwd), '.claude') : undefined
  let claudeDirIsSymlink = false
  try {
    claudeDirIsSymlink = claudeDir ? lstatSync(claudeDir).isSymbolicLink() : false
  } catch {
    claudeDirIsSymlink = false
  }
  // Whether git tracks the local file is not read: Localix runs no git for a settings read.
  return permissionRuleLists(settings.policy().view, () => settings.trusted, {
    tracked: false,
    claudeDirIsSymlink,
  })
}

/** The highest file of a scope: the one a rule the kit kept for that scope reads as coming from. */
function fileOf(settings: ClaudeSettings, scope: PolicyScope): SettingsFile | undefined {
  return settings.files.findLast((one) => one.scope === scope)
}

export function settingsRuleEntries(settings: ClaudeSettings): SettingsRuleEntry[] {
  const lists = listsOf(settings)
  return EFFECTS.flatMap((effect) =>
    lists[effect].flatMap((entry) => {
      const file = fileOf(settings, entry.scope)
      if (!file) return []
      return [
        { effect, raw: entry.rule, file: file.file, sourceDir: file.anchorDir, scope: entry.scope },
      ]
    }),
  )
}

/**
 * `permissions.additionalDirectories` in force, absolute: relative entries resolve against the
 * working directory and `~` against home.
 */
export function settingsAdditionalDirectories(settings: ClaudeSettings): string[] {
  const { cwd, homeDir } = settings.input
  const base = cwd ? resolve(cwd) : homeDir
  const dirs = listsOf(settings).additionalDirectories.flatMap(({ directory }) => {
    const dir = directory.trim()
    if (!dir) return []
    return [dir === '~' || dir.startsWith('~/') ? join(homeDir, dir.slice(1)) : resolve(base, dir)]
  })
  return [...new Set(dirs)]
}
