import type { PluginSession, Resolved, ResolvedMcpServer } from '@rsaryev/llx-plugin'
import type { LocalixPluginHost } from './host'
import type { ManagedSettingsSource } from './settings/managed'
import { openOwnSession, pluginErrors, sessionOwn, type ScopePlugin } from './sessions'
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
 * A kit session of a scope outside any chat, opened as a chat's run opens its own
 * (`openOwnSession`), with the folder's Claude Code settings: what a loader asks of the scope (its
 * MCP servers, its subagents, its skills) is answered by the kit as a run in that folder would see it.
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
  const session = { sessionId, cwd: scope.cwd, transcriptPath: '', trusted: settings.trusted }
  return openOwnSession(host, own, { ...session, permissionMode: 'default' }, scope.homeDir)
}

/**
 * Whether each plugin of a scope runs, as the kit judges it in a session of the scope: the one
 * verdict every loader starts plugin code by. The agent's selection, managed settings over it (a
 * plugin they turn on or off), and a dependency not installed, disabled or outside its range.
 */
export interface ScopeRun {
  /** The ids of the plugins the scope runs. */
  readonly running: ReadonlySet<string>
  /** The kit's error against a plugin, by id (`pluginErrors`). */
  readonly errors: ReadonlyMap<string, string>
  /**
   * The MCP servers of the running plugins (`session.mcpServers`). A server that does not start (a
   * bundle's required setting unsaved, a variable unset) is left out and its issue reported.
   */
  readonly mcpServers: () => Promise<Resolved<ResolvedMcpServer>>
}

export async function scopeRun(host: LocalixPluginHost, scope: PluginScope): Promise<ScopeRun> {
  const session = await openScopeSession(host, scope, 'scope-run')
  return {
    running: new Set(session.plugins.flatMap((one) => (one.enabled ? [one.id] : []))),
    errors: pluginErrors(session),
    mcpServers: () => session.mcpServers(),
  }
}
