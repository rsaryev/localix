import { promises as fs } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'

import { isRecord } from '../../lib/record'
import { claudeConfigDir } from './config-dir'
import {
  readManagedSettings,
  systemManagedSource,
  type ManagedSettingsSource,
} from './managed-settings'
import { mergeSettingsSources, type Settings, type SettingsSource } from './settings-merge'

/**
 * THE SETTINGS FILES CLAUDE CODE READS FOR A SESSION, read where it reads them (settings.md,
 * "Settings files and who they affect", "Where Claude Code keeps the local file in a git
 * repository"):
 *
 *   user     `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`
 *   project  `<cwd>/.claude/settings.json` — the working directory's own, no parent fallback
 *   local    `.claude/settings.local.json` at the repository root (a worktree's main checkout),
 *            and the working directory's own as earlier versions kept it; the root's wins
 *   policy   the managed settings (`managed-settings.ts`)
 *
 * Each layer keeps where it came from: a permission rule's `/path` anchors at its source.
 * Read-only: nothing here writes a Claude Code file.
 */

export interface SettingsLayer {
  source: SettingsSource
  file: string
  /** Where a `/path` permission rule of this layer anchors (permissions.md, "Where a pattern anchors"). */
  anchorDir: string
  settings: Settings
}

export interface SettingsFilesInput {
  homeDir: string
  /** The session's working directory; null outside a project. */
  cwd: string | null
  env?: Record<string, string | undefined>
  /** The managed source; the machine's own by default, `null` to read none. */
  managed?: ManagedSettingsSource | null
  platform?: NodeJS.Platform
}

async function readSettingsFile(file: string): Promise<Settings | undefined> {
  const text = await fs.readFile(file, 'utf8').catch(() => null)
  if (text === null) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * The repository root Claude Code keeps the local settings file at: the nearest folder holding
 * `.git`, a worktree resolved to its main checkout. Null where Claude Code keeps it beside the
 * project file instead: outside a repository, a repository rooted at home, and on Windows.
 */
export async function localSettingsRoot(
  cwd: string,
  homeDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (platform === 'win32') return null
  let current = resolve(cwd)
  for (;;) {
    const marker = join(current, '.git')
    const stat = await fs.stat(marker).catch(() => null)
    if (stat?.isDirectory()) return current === resolve(homeDir) ? null : current
    if (stat?.isFile()) {
      const text = await fs.readFile(marker, 'utf8').catch(() => '')
      const gitdir = /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim()
      const linked = gitdir ? resolve(current, gitdir) : ''
      const at = linked.lastIndexOf('/.git/worktrees/')
      const main = at > 0 ? linked.slice(0, at) : current
      return main === resolve(homeDir) ? null : main
    }
    const parent = dirname(current)
    if (parent === current || current === parse(current).root) return null
    current = parent
  }
}

/** Every settings layer of the session, lowest precedence first; absent files are skipped. */
export async function readSettingsLayers(input: SettingsFilesInput): Promise<SettingsLayer[]> {
  const env = input.env ?? process.env
  const configDir = claudeConfigDir(input.homeDir, env)
  const layers: SettingsLayer[] = []
  const push = async (source: SettingsSource, file: string, anchorDir: string) => {
    const settings = await readSettingsFile(file)
    if (settings) layers.push({ source, file, anchorDir, settings })
  }
  await push('user', join(configDir, 'settings.json'), configDir)
  const cwd = input.cwd ? resolve(input.cwd) : null
  // A session in the home folder reads the user file once, not again as its project's.
  if (cwd && join(cwd, '.claude') !== configDir) {
    await push('project', join(cwd, '.claude', 'settings.json'), cwd)
    const root = await localSettingsRoot(cwd, input.homeDir, input.platform)
    // Local rules anchor at the working directory wherever the file is kept.
    if (root && root !== cwd) await push('local', join(cwd, '.claude', 'settings.local.json'), cwd)
    await push('local', join(root ?? cwd, '.claude', 'settings.local.json'), cwd)
  }
  const managed = input.managed === undefined ? systemManagedSource(input.platform) : input.managed
  if (managed) {
    const settings = await readManagedSettings(managed)
    if (Object.keys(settings).length > 0)
      layers.push({
        source: 'policy',
        file: managed.dir,
        anchorDir: cwd ?? input.homeDir,
        settings,
      })
  }
  return layers
}

/** The session's settings with every layer merged, as Claude Code applies them. */
export async function readMergedSettings(input: SettingsFilesInput): Promise<Settings> {
  return mergeSettingsSources(await readSettingsLayers(input))
}
