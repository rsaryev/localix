import { readFileSync, statSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'

import { readJsonRecordSync } from '../../lib/json'
import { claudeConfigDir } from './config-dir'
import {
  readManagedFiles,
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
 *   local    `.claude/settings.local.json` at the repository root (a linked checkout's main one),
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

/**
 * The repository root Claude Code keeps the local settings file at: the nearest folder holding
 * `.git`, a linked checkout resolved to its main one. Null where Claude Code keeps it beside the
 * project file instead: outside a repository, a repository rooted at home, and on Windows.
 */
export function localSettingsRoot(
  cwd: string,
  homeDir: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform === 'win32') return null
  let current = resolve(cwd)
  for (;;) {
    const marker = join(current, '.git')
    let stat: ReturnType<typeof statSync> | null = null
    try {
      stat = statSync(marker)
    } catch {
      stat = null
    }
    if (stat?.isDirectory()) return current === resolve(homeDir) ? null : current
    if (stat?.isFile()) {
      let text = ''
      try {
        text = readFileSync(marker, 'utf8')
      } catch {
        text = ''
      }
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

/** The managed source the input names: the machine's own by default, none for `null`. */
const managedSourceOf = (input: SettingsFilesInput) =>
  input.managed === undefined ? systemManagedSource(input.platform) : input.managed

/** The managed settings as a layer, anchored at the session's folder (home without one). */
function policyLayer(
  managed: ManagedSettingsSource,
  settings: Settings,
  cwd: string | null,
  homeDir: string,
): SettingsLayer {
  return { source: 'policy', file: managed.dir, anchorDir: cwd ?? homeDir, settings }
}

/**
 * The settings files of the session, lowest precedence first, read synchronously: the managed
 * layer here is the file-based policy alone (`managed-settings.json` and its drop-ins). For a
 * caller that cannot wait — a connection key, a spawn's environment.
 */
export function readSettingsFileLayers(input: SettingsFilesInput): SettingsLayer[] {
  const env = input.env ?? process.env
  const configDir = claudeConfigDir(input.homeDir, env)
  const layers: SettingsLayer[] = []
  const push = (source: SettingsSource, file: string, anchorDir: string) => {
    const settings = readJsonRecordSync(file)
    if (settings) layers.push({ source, file, anchorDir, settings })
  }
  push('user', join(configDir, 'settings.json'), configDir)
  const cwd = input.cwd ? resolve(input.cwd) : null
  // A session in the home folder reads the user file once, not again as its project's.
  if (cwd && join(cwd, '.claude') !== configDir) {
    push('project', join(cwd, '.claude', 'settings.json'), cwd)
    const root = localSettingsRoot(cwd, input.homeDir, input.platform)
    // Local rules anchor at the working directory wherever the file is kept.
    if (root && root !== cwd) push('local', join(cwd, '.claude', 'settings.local.json'), cwd)
    push('local', join(root ?? cwd, '.claude', 'settings.local.json'), cwd)
  }
  const managed = managedSourceOf(input)
  if (managed) {
    const settings = readManagedFiles(managed.dir)
    if (settings && Object.keys(settings).length > 0)
      layers.push(policyLayer(managed, settings, cwd, input.homeDir))
  }
  return layers
}

/** Every settings layer of the session, the MDM policy included; absent files are skipped. */
export async function readSettingsLayers(input: SettingsFilesInput): Promise<SettingsLayer[]> {
  const layers = readSettingsFileLayers({ ...input, managed: null })
  const managed = managedSourceOf(input)
  if (managed) {
    const settings = await readManagedSettings(managed)
    const cwd = input.cwd ? resolve(input.cwd) : null
    if (Object.keys(settings).length > 0)
      layers.push(policyLayer(managed, settings, cwd, input.homeDir))
  }
  return layers
}

/** `outputStyle` of the session's settings: the style a chat speaks in when none is chosen. */
export function claudeCodeOutputStyle(input: SettingsFilesInput): string | undefined {
  const style = mergeSettingsSources(readSettingsFileLayers(input)).outputStyle
  return typeof style === 'string' && style.trim() ? style.trim() : undefined
}
