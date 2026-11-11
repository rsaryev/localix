import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  createGeneralView,
  localSettingsFiles,
  localSettingsRoot,
  policyContext,
  readSettingsLayer,
  resolvePolicy,
  type FileScope,
  type GeneralView,
  type ManagedComposition,
  type PolicyLayer,
  type ResolvedPolicy,
} from '@rsaryev/llx-plugin/settings'
import type { PluginIssue } from '@rsaryev/llx-plugin/format'
import { claudeConfigDir } from '../../../cc-settings/config-dir'
import {
  composeManagedSource,
  readManagedComposition,
  systemManagedSource,
  type ManagedSettingsSource,
} from './managed'
import { folderRepository, type FolderRepository } from './repository'
import { folderTrusted } from './trust'

/**
 * THE CLAUDE CODE SETTINGS OF A SESSION, read where Claude Code reads them and through the kit:
 * Localix reads the files (host I/O) and the kit reads each into a layer (`readSettingsLayer`:
 * aliases, the keys a scope may carry, repairs, the values it refuses), composes the managed
 * sources (`composeManagedReads`), merges (`createGeneralView`) and decides every policy key
 * (`resolvePolicy`). Read-only: nothing here writes a Claude Code file.
 *
 *   user     `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`
 *   project  `<cwd>/.claude/settings.json`, skipped when that is the user folder (a home session)
 *   local    `.claude/settings.local.json` where the kit places it (`localSettingsFiles`)
 *   managed  the managed sources of the machine (`./managed`)
 */

export type Settings = PolicyLayer['settings']

export interface SettingsFile {
  scope: FileScope
  file: string
  /** Where a `/path` permission rule of this file anchors (permissions.md, "Where a pattern anchors"). */
  anchorDir: string
  /** The file as the kit read it. */
  settings: Settings
}

export interface ClaudeSettingsInput {
  homeDir: string
  /** The session's working directory; null outside a project. */
  cwd: string | null
  env?: Record<string, string | undefined>
  /** The managed source; the machine's own by default, `null` to read none. */
  managed?: ManagedSettingsSource | null
  platform?: NodeJS.Platform
}

export interface ClaudeSettings {
  readonly input: ClaudeSettingsInput
  /** The files read, lowest precedence first. */
  readonly files: readonly SettingsFile[]
  readonly layers: readonly PolicyLayer[]
  readonly repository: FolderRepository | undefined
  /** The folder holding the local file, when the kit keeps it at the repository root. */
  readonly localRoot: string | undefined
  /** Claude Code trusts the session's folder (false outside a project). */
  readonly trusted: boolean
  readonly managed: ManagedComposition | undefined
  readonly view: GeneralView
  readonly issues: readonly PluginIssue[]
  /** Every policy key decided, computed on first use. */
  policy(): ResolvedPolicy
}

const jsonOf = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

interface FileRead {
  scope: Exclude<FileScope, 'managed'>
  file: string
  anchorDir: string
}

function fileReads(
  input: ClaudeSettingsInput,
  cwd: string | null,
  repository: FolderRepository | undefined,
) {
  const configDir = claudeConfigDir(input.homeDir, input.env ?? process.env)
  const reads: FileRead[] = [
    { scope: 'user', file: join(configDir, 'settings.json'), anchorDir: configDir },
  ]
  // A session in the home folder reads the user file once, not again as its project's.
  if (!cwd || join(cwd, '.claude') === configDir) return reads
  reads.push({ scope: 'project', file: join(cwd, '.claude', 'settings.json'), anchorDir: cwd })
  const placement = { homeDir: input.homeDir, windows: input.platform === 'win32', repository }
  // The kit lists the one that applies first first; lowest first here. Local rules anchor at cwd.
  for (const file of localSettingsFiles({
    ...placement,
    projectDir: cwd,
    joinPath: join,
  }).toReversed())
    reads.push({ scope: 'local', file, anchorDir: cwd })
  return reads
}

function settingsOf(
  input: ClaudeSettingsInput,
  managed: ManagedComposition | undefined,
): ClaudeSettings {
  const cwd = input.cwd ? resolve(input.cwd) : null
  const repository = cwd ? folderRepository(cwd) : undefined
  const issues: PluginIssue[] = [...(managed?.issues ?? [])]
  const files: SettingsFile[] = fileReads(input, cwd, repository).flatMap((read) => {
    const raw = jsonOf(read.file)
    if (raw === undefined) return []
    const layer = readSettingsLayer(read.scope, raw, read.file)
    issues.push(...layer.issues)
    return [{ ...read, settings: layer.layer.settings }]
  })
  const managedSettings = managed?.layer.settings ?? {}
  if (managed && Object.keys(managedSettings).length > 0) {
    const dir = (input.managed ?? systemManagedSource(input.platform)).dir
    files.push({
      scope: 'managed',
      file: dir,
      anchorDir: cwd ?? input.homeDir,
      settings: managedSettings,
    })
  }
  // Highest first, as the kit's views order a scope's two files.
  const layers = files
    .map((one): PolicyLayer => ({ scope: one.scope, settings: one.settings }))
    .toReversed()
  const trusted = cwd
    ? folderTrusted({ homeDir: input.homeDir, cwd, env: input.env, repository })
    : false
  let policy: ResolvedPolicy | undefined
  return {
    input,
    files,
    layers,
    repository,
    localRoot: localSettingsRoot({
      homeDir: input.homeDir,
      windows: input.platform === 'win32',
      repository,
    }),
    trusted,
    managed,
    view: createGeneralView(layers),
    issues,
    policy: () =>
      (policy ??= resolvePolicy({
        layers,
        context: policyContext({ isFolderTrusted: () => trusted, env: input.env ?? process.env }),
        ...(managed ? { managed } : {}),
      })),
  }
}

const managedSourceOf = (input: ClaudeSettingsInput) =>
  input.managed === undefined ? systemManagedSource(input.platform) : input.managed

/**
 * The settings read synchronously: the managed layer is the file-based policy alone (no MDM
 * profile). For a caller that cannot wait — a connection key, a spawn's environment.
 */
export function readClaudeSettingsSync(input: ClaudeSettingsInput): ClaudeSettings {
  const source = managedSourceOf(input)
  return settingsOf(input, source ? composeManagedSource(source) : undefined)
}

/** The settings with every managed source of the machine, the MDM profile included. */
export async function readClaudeSettings(input: ClaudeSettingsInput): Promise<ClaudeSettings> {
  const source = managedSourceOf(input)
  if (!source) return settingsOf(input, undefined)
  return settingsOf(input, await readManagedComposition(source))
}

/** The settings of one scope as the kit merges that scope's files (the two local files as one), or of every scope. */
export function mergedSettings(settings: ClaudeSettings, scope?: FileScope): Readonly<Settings> {
  return scope
    ? createGeneralView(settings.layers.filter((one) => one.scope === scope)).merged()
    : settings.view.merged()
}
