import type { PluginSession } from '@rsaryev/llx-plugin'
import { createPolicyView } from '@rsaryev/llx-plugin/settings'
import type { LocalixPluginHost } from './host'
import type { ManagedSettingsSource } from './settings/managed'
import { sessionLocations, sessionOwn, type ScopePlugin } from './sessions'
import { readClaudeSettings } from './settings/read'

/** One scope: its folder, the home its Claude Code settings are read from, its catalog. */
export interface PluginScope {
  readonly cwd: string
  readonly homeDir: string
  readonly plugins: readonly ScopePlugin[]
  /** The managed settings; the machine's own by default, `null` for none. */
  readonly managed?: ManagedSettingsSource | null
}

/**
 * A kit session of a scope outside any chat, set up as a chat's run sets up its own
 * (`./sessions`), with the folder's Claude Code settings: what a loader asks of the scope (its MCP
 * servers, its subagents) is answered by the kit as a run in that folder would see it.
 */
export async function openScopeSession(
  host: LocalixPluginHost,
  scope: PluginScope,
  sessionId: string,
): Promise<PluginSession> {
  const settings = await readClaudeSettings({
    homeDir: scope.homeDir,
    cwd: scope.cwd,
    ...(scope.managed === undefined ? {} : { managed: scope.managed }),
  })
  const own = sessionOwn(host, { layers: settings.layers, plugins: scope.plugins })
  const locations = {
    ...sessionLocations(host, scope.cwd, own.plugins),
    homeDir: () => scope.homeDir,
  }
  const session = host.kit.openSession({
    sessionId,
    cwd: scope.cwd,
    permissionMode: 'default',
    transcriptPath: '',
    trusted: settings.trusted,
    settings: createPolicyView(own.layers),
    plugins: own.plugins.map(({ id, plugin }) => ({ id, plugin })),
    userConfig: own.userConfig,
    locations,
  })
  return session
}
