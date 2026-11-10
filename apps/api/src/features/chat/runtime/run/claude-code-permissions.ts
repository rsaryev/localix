import type { PermissionMode } from '../../../../contracts/permission-modes'
import type { OuterRules } from '../../../agent-core/permission-verdict'
import {
  readClaudeSettings,
  settingsAdditionalDirectories,
  settingsRuleEntries,
  settingsResolvedPaths,
  settingsRules,
  settingsVerdict,
  withRealDirectories,
  withSessionRules,
  type ClaudeSettingsInput,
  type SettingsRules,
} from '../../../plugins/kit'

/**
 * THE PERSON'S CLAUDE CODE `permissions`, AT A RUN'S GATE. A run in a folder reads the settings
 * files Claude Code would read there (`readClaudeSettings` of `plugins/kit`) and hands their rules to
 * the gate as the outer rule set (`agent-core/permission-verdict.ts`, `outerRules`), judged by the
 * kit (`plugins/kit/permissions.ts`): a deny refuses, an ask raises a card, whatever the agent's own
 * rules say, and an allow answers the agent's catch-all question. A session mode that stops asking (Bypass, Autonomous) stops
 * asking about these too, as `bypassPermissions` does; denials hold in every mode.
 */

export interface ClaudeCodePermissions {
  /** The rules in force, as the kit reads and matches them (`plugins/kit/permissions.ts`). */
  rules: SettingsRules
  /** `permissions.additionalDirectories`, absolute. */
  additionalDirectories: string[]
  cwd: string
}

export async function loadClaudeCodePermissions(
  input: ClaudeSettingsInput & { cwd: string },
): Promise<ClaudeCodePermissions> {
  const settings = await readClaudeSettings(input)
  const additionalDirectories = settingsAdditionalDirectories(settings)
  return {
    rules: await withRealDirectories(
      settingsRules(settingsRuleEntries(settings), {
        cwd: input.cwd,
        homeDir: input.homeDir,
        additionalDirectories,
      }),
    ),
    additionalDirectories,
    cwd: input.cwd,
  }
}

const STOPS_ASKING: ReadonlySet<PermissionMode> = new Set(['bypass', 'autonomous'])

const where = (verdict: { rule: string; where: string }) => `${verdict.rule} in ${verdict.where}`

/** What the gate takes from the person's Claude Code settings for one run. */
export function claudeCodeGateOptions(
  permissions: ClaudeCodePermissions,
  options: { mode: PermissionMode },
): { outerRules: OuterRules; extraRoots?: string[] } {
  return {
    outerRules: claudeCodeOuterRules(permissions.rules, options.mode),
    ...(permissions.additionalDirectories.length > 0
      ? { extraRoots: permissions.additionalDirectories }
      : {}),
  }
}

/** The Claude Code rules of a run with no settings read: what a skill or command adds. */
export function runOuterRules(cwd: string, homeDir: string): OuterRules {
  return claudeCodeOuterRules(
    settingsRules([], { cwd, homeDir, additionalDirectories: [] }),
    'default',
  )
}

export function claudeCodeOuterRules(start: SettingsRules, mode: PermissionMode): OuterRules {
  let rules = start
  return {
    with: (added) => claudeCodeOuterRules(withSessionRules(rules, added), mode),
    add: (added) => {
      rules = withSessionRules(rules, added)
    },
    prepare: async ({ toolName, input, tool }, signal) => {
      if (rules.rules.length === 0) return undefined
      const found = await settingsResolvedPaths(rules, tool ?? { name: toolName }, input, signal)
      return found.some(Boolean) ? found : undefined
    },
    judge: ({ toolName, input, tool, prepared }) => {
      if (rules.rules.length === 0) return undefined
      const verdict = settingsVerdict(rules, tool ?? { name: toolName }, input, prepared)
      if (!verdict) return undefined
      if (verdict.effect === 'ask' && STOPS_ASKING.has(mode)) return undefined
      const message =
        verdict.message ?? `Blocked by the Claude Code permission rule ${where(verdict)}.`
      return {
        action: verdict.effect,
        rule: where(verdict),
        ...(verdict.effect === 'deny' ? { message } : {}),
      }
    },
  }
}
