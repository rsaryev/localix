import type { DenyRuleChecker, ModsPolicyInput } from '@rsaryev/llx-plugin/mods'
import {
  hostPlatform,
  localToolName,
  mergedSettings,
  settingsAdditionalDirectories,
  settingsRuleEntries,
  settingsRules,
  settingsVerdict,
  toolInputOf,
  type ClaudeSettings,
} from '../../plugins/kit'
import type { ModSource } from '../contracts'

/**
 * What the kit's mods host decides a conversation's mods by, from the Claude Code settings Localix
 * runs under in that folder: the load policy (managed settings, the user's, each plugin's saved
 * options) and the permission rules the kit's guard checks a user's mod's approval against. With
 * managed settings on the machine the guard loads, and a mod that answers `allow` at `tool.check`
 * for a call those rules deny or ask about is refused, as in Claude Code.
 */

/** A Localix plugin as the kit's host names it: the name, loaded from where Localix installed it. */
export const modIdOf = (plugin: string) => `${plugin}@inline`

/** The load policy of a host whose mods are `sources`. Localix signs in with provider API keys. */
export function sessionPolicy(
  settings: ClaudeSettings,
  sources: readonly ModSource[],
  env: Readonly<Record<string, string | undefined>>,
): ModsPolicyInput {
  const user = mergedSettings(settings, 'user')
  const pluginConfigs = {
    ...user.pluginConfigs,
    // A plugin's `userConfig` values, as Localix saved them for it.
    ...Object.fromEntries(
      sources.map((source) => [modIdOf(source.plugin), { options: source.options }]),
    ),
  }
  const managed = settings.managed?.hasManagedSettings
    ? mergedSettings(settings, 'managed')
    : undefined
  return {
    ...(managed ? { managed } : {}),
    user: { ...user, pluginConfigs },
    credential: 'api-key',
    env,
    platform: hostPlatform(),
    flags: { pluginDirs: [] },
  }
}

/** The person's permission rules in `cwd`, as the run's gate reads them, for the guard. */
export function sessionDeny(
  settings: ClaudeSettings,
  cwd: string,
  homeDir: string,
): DenyRuleChecker {
  const rules = settingsRules(settingsRuleEntries(settings), {
    cwd,
    homeDir,
    additionalDirectories: settingsAdditionalDirectories(settings),
  })
  return {
    async verdict(toolName, input) {
      const name = localToolName(toolName)
      const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
      const verdict = settingsVerdict(rules, { name }, toolInputOf(name, args))
      return verdict === undefined || verdict.effect === 'allow' ? 'none' : verdict.effect
    },
  }
}
