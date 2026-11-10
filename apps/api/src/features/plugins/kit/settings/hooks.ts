import {
  hookSessionGates,
  readCommandLine,
  type HttpHookVerdict,
  type PolicyHookSource,
} from '@rsaryev/llx-plugin/settings'
import type { ClaudeSettings } from './read'

/**
 * Which hooks of a session may run, decided by the kit (`hookSessionGates`, `HookPolicy.runs`:
 * `disableAllHooks`, `allowManagedHooksOnly`, `strictPluginOnlyCustomization` with `hooks`, the
 * plugins managed settings force-enable), and the hooks blocks of the settings files. A
 * project's and the local file's hooks wait for the folder's trust, as Claude Code holds them.
 */
export interface SettingsHooks {
  /** The hooks blocks to load, lowest precedence first, with the scope each came from. */
  blocks: Array<{ source: 'user' | 'project' | 'local'; raw: unknown; managed: boolean }>
  /** Whether a plugin's hooks may run (`<name>@<marketplace>` or the bare name). */
  pluginAllowed: (plugin: string) => boolean
  /** Whether a skill's or an agent's frontmatter hooks may run. */
  frontmatterAllowed: (owner: 'skill' | 'agent') => boolean
  /** `allowedHttpHookUrls` and `httpHookAllowedEnvVars`: whether an http hook runs and what it may read. */
  httpHook: (url: string, hookAllowedEnvVars: readonly string[]) => HttpHookVerdict
}

const pluginOrigin = (id: `${string}@${string}`): PolicyHookSource => ({
  kind: 'plugin',
  id,
  skillsDirPlugin: false,
  commandSource: false,
  isMod: false,
  isOrgMod: false,
})

/** The ids a plugin name can stand for: the full id as given, else the `enabledPlugins` keys of that name. */
function idsOf(settings: ClaudeSettings, plugin: string): Array<`${string}@${string}`> {
  if (plugin.includes('@')) return [plugin as `${string}@${string}`]
  const named = Object.keys(settings.view.get('enabledPlugins') ?? {}).filter(
    (id): id is `${string}@${string}` => id.slice(0, id.lastIndexOf('@')) === plugin,
  )
  return named.length > 0 ? named : [`${plugin}@local`]
}

export function settingsHooks(settings: ClaudeSettings): SettingsHooks {
  const policy = settings.policy()
  const gates = hookSessionGates(policy.view, {
    hasManagedSettings: settings.managed?.hasManagedSettings ?? false,
    parentMerge: settings.managed?.parentMerge ?? false,
  })
  const blocks = gates.settingsHooks.toReversed().flatMap((block): SettingsHooks['blocks'] => {
    const managed = block.scope === 'managed'
    const origin: PolicyHookSource = managed
      ? { kind: 'managedSettings' }
      : {
          kind: 'settings',
          scope: block.scope === 'local' || block.scope === 'project' ? block.scope : 'user',
        }
    if (!policy.hooks.runs(origin).run) return []
    const repository = block.scope === 'project' || block.scope === 'local'
    if (repository && !settings.trusted) return []
    // A managed hook reads as a user one: Localix's sources name where a person writes hooks.
    const source = repository ? block.scope : 'user'
    return [{ source, raw: { hooks: block.hooks }, managed }]
  })
  return {
    blocks,
    pluginAllowed: (plugin) =>
      idsOf(settings, plugin).some((id) => policy.hooks.runs(pluginOrigin(id)).run),
    frontmatterAllowed: (owner) =>
      policy.hooks.runs({ kind: 'frontmatter', owner, from: 'user' }).run,
    httpHook: (url, allowed) => policy.hooks.httpHook(url, allowed),
  }
}

export interface SettingsCommandLine {
  command: string
  padding: number
  refreshInterval?: number
}

/** `statusLine` or `subagentStatusLine` as the kit lets it run (`readCommandLine`), else undefined. */
export function settingsCommandLine(
  settings: ClaudeSettings,
  key: 'statusLine' | 'subagentStatusLine',
): SettingsCommandLine | undefined {
  const policy = settings.policy()
  const value = readCommandLine(policy.view, key, policy.hooks).runs?.value
  if (!value?.command.trim()) return undefined
  const padding =
    typeof value.padding === 'number' && value.padding > 0 ? Math.floor(value.padding) : 0
  const refresh = value.refreshInterval
  return {
    command: value.command,
    padding,
    ...(typeof refresh === 'number' ? { refreshInterval: refresh } : {}),
  }
}
