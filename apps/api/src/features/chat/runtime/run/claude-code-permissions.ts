import type { PermissionMode } from '../../../../contracts/permission-modes'
import type { OuterRules } from '../../../agent-core/permission-verdict'
import { readSettingsLayers, type SettingsFilesInput } from '../../../cc-settings/settings-files'
import { claudeCodeTrusts } from '../../../cc-settings/settings-trust'
import { bashFiles } from '../../../cc-settings/settings-bash-paths'
import type { PermissionRule } from '../../../agent-core/permission-engine'
import {
  settingsAllowRows,
  settingsAdditionalDirectories,
  settingsPermissionDecision,
  settingsPermissionRules,
  type CcPermissionRule,
} from '../../../cc-settings/settings-permissions'

/**
 * THE PERSON'S CLAUDE CODE `permissions`, AT A RUN'S GATE. A run in a folder reads the settings
 * files Claude Code would read there (`cc-settings/settings-files.ts`) and hands their rules to
 * the gate: its deny and ask rules as the outer rule set (`agent-core/permission-verdict.ts`,
 * `outerRules`) — a deny refuses, an ask raises a card, whatever the agent's own rules say — and
 * its allow rules as pre-approvals (`cc-settings/cc-rule-translate.ts`), which answer the agent's
 * catch-all question. A session mode that stops asking (Bypass, Autonomous) stops
 * asking about these too, as `bypassPermissions` does; denials hold in every mode.
 */

export interface ClaudeCodePermissions {
  rules: CcPermissionRule[]
  /** `permissions.additionalDirectories`, absolute. */
  additionalDirectories: string[]
  cwd: string
}

export async function loadClaudeCodePermissions(
  input: SettingsFilesInput & { cwd: string },
): Promise<ClaudeCodePermissions> {
  const layers = await readSettingsLayers(input)
  const projectTrusted = claudeCodeTrusts(input)
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
): { outerRules?: OuterRules; extraRoots?: string[]; preapprovedRules?: PermissionRule[] } {
  const allows = settingsAllowRows(permissions.rules, permissions.cwd)
  return {
    ...(allows.length > 0 ? { preapprovedRules: allows } : {}),
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
