import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { PermissionMode } from '../../../../contracts/permission-modes'
import type { OuterRules } from '../../../agent-core/permission-verdict'
import { claudeStateFile } from '../../../cc-settings/config-dir'
import {
  localSettingsRoot,
  readSettingsLayers,
  type SettingsFilesInput,
} from '../../../cc-settings/settings-files'
import { bashFiles } from '../../../cc-settings/settings-bash-paths'
import {
  settingsAdditionalDirectories,
  settingsPermissionDecision,
  settingsPermissionRules,
  type CcPermissionRule,
} from '../../../cc-settings/settings-permissions'
import { isRecord } from '../../../../lib/record'

/**
 * THE PERSON'S CLAUDE CODE `permissions`, AT A RUN'S GATE. A run in a folder reads the settings
 * files Claude Code would read there (`cc-settings/settings-files.ts`) and hands their rules to
 * the gate as its outer rule set (`agent-core/permission-verdict.ts`, `outerRules`): the agent's
 * own rules stay as they are, a Claude Code deny refuses, an ask raises a card, an allow answers
 * the agent's catch-all question. A session mode that stops asking (Bypass, Autonomous) stops
 * asking about these too, as `bypassPermissions` does; denials hold in every mode.
 */

export interface ClaudeCodePermissions {
  rules: CcPermissionRule[]
  /** `permissions.additionalDirectories`, absolute. */
  additionalDirectories: string[]
  cwd: string
}

/**
 * Whether Claude Code trusts the folder: `projects["<root>"].hasTrustDialogAccepted` in its state
 * file, keyed on the repository root (a worktree's main checkout) or the folder, or a parent
 * folder outside a repository (permissions.md, "Project allow rules and workspace trust").
 */
export async function claudeCodeTrusts(input: SettingsFilesInput & { cwd: string }) {
  const text = await fs.readFile(claudeStateFile(input.homeDir, input.env), 'utf8').catch(() => '')
  let projects: unknown
  try {
    projects = text ? (JSON.parse(text) as { projects?: unknown }).projects : undefined
  } catch {
    return false
  }
  if (!isRecord(projects)) return false
  const trusted = (dir: string) => {
    const entry = projects[dir]
    return isRecord(entry) && entry.hasTrustDialogAccepted === true
  }
  const root = await localSettingsRoot(input.cwd, input.homeDir, input.platform)
  if (root) return trusted(root)
  for (let dir = resolve(input.cwd); ; dir = dirname(dir)) {
    if (trusted(dir)) return true
    if (dirname(dir) === dir) return false
  }
}

export async function loadClaudeCodePermissions(
  input: SettingsFilesInput & { cwd: string },
): Promise<ClaudeCodePermissions> {
  const [layers, projectTrusted] = await Promise.all([
    readSettingsLayers(input),
    claudeCodeTrusts(input),
  ])
  return {
    rules: settingsPermissionRules(layers, { projectTrusted }),
    additionalDirectories: settingsAdditionalDirectories(layers, {
      projectTrusted,
      cwd: input.cwd,
      homeDir: input.homeDir,
    }),
    cwd: input.cwd,
  }
}

const STOPS_ASKING: ReadonlySet<PermissionMode> = new Set(['bypass', 'autonomous'])

const where = (rule: CcPermissionRule) => `${rule.raw} in ${rule.file}`

/** What the gate takes from the person's Claude Code settings for one run. */
export function claudeCodeGateOptions(
  permissions: ClaudeCodePermissions,
  options: { homeDir: string; mode: PermissionMode },
): { outerRules?: OuterRules; extraRoots?: string[] } {
  return {
    ...(permissions.rules.length > 0 ? { outerRules: claudeCodeRules(permissions, options) } : {}),
    ...(permissions.additionalDirectories.length > 0
      ? { extraRoots: permissions.additionalDirectories }
      : {}),
  }
}

function claudeCodeRules(
  permissions: ClaudeCodePermissions,
  options: { homeDir: string; mode: PermissionMode },
): OuterRules {
  return ({ toolName, input, tool, facts, writes }) => {
    // A shell line's own files: what `cat`, `sed`, `tee` and redirections name.
    const shell =
      toolName === 'bash' && facts.commands
        ? facts.commands.map((line) =>
            bashFiles(line, facts.paths[0] ?? permissions.cwd, options.homeDir),
          )
        : []
    const shellWrites = shell.flatMap((files) => files.writes)
    const decision = settingsPermissionDecision(permissions.rules, {
      toolName,
      ...(tool?.aliases ? { aliases: tool.aliases } : {}),
      input,
      // A shell call's first path is its working directory, which the line does not read.
      paths:
        toolName === 'bash'
          ? [
              ...facts.paths.slice(1),
              ...shell.flatMap((files) => [...files.reads, ...files.writes]),
            ]
          : facts.paths,
      writes: toolName === 'bash' ? shellWrites : writes,
      ...(facts.commands ? { commands: facts.commands } : {}),
      cwd: permissions.cwd,
      homeDir: options.homeDir,
    })
    if (!decision) return undefined
    if (decision.effect === 'ask' && STOPS_ASKING.has(options.mode)) return undefined
    return {
      action: decision.effect,
      rule: where(decision.rule),
      ...(decision.effect === 'deny'
        ? { message: `Blocked by the Claude Code permission rule ${where(decision.rule)}.` }
        : {}),
    }
  }
}
