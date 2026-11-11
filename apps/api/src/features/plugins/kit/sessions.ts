import {
  normalizePermissionMode,
  type Locations,
  type OptionValues,
  type PluginSession,
  type SessionOptions,
} from '@rsaryev/llx-plugin'
import type { TrustSituation } from '@rsaryev/llx-plugin/loading'
import { createPolicyView, type PolicyLayer } from '@rsaryev/llx-plugin/settings'
import { keepUnchanged, samePlugins, type LoadedKitPlugin, type LocalixPluginHost } from './host'
import { contentApplies } from './settings/trust'
import { LOCALIX_TOOL_NAMES } from './tool-names'

/**
 * A plugin of the run's catalog: whether the run's agent may use it (`capability_rule`, trust), a
 * user-scope install (the host's) or the project's own (the session's), and its saved values.
 */
export interface ScopePlugin extends LoadedKitPlugin {
  readonly selected: boolean
  readonly scope: 'user' | 'project'
  /** Its options by key and its bundled servers' settings under `<server>.<key>`. */
  readonly values: OptionValues
}

/** What a chat's run knows of the session it runs in. */
export interface ChatSessionFacts {
  readonly chatId: string
  /** The run's folder; the folder of the first run is the session's project (`CLAUDE_PROJECT_DIR`). */
  readonly cwd: string
  readonly transcriptPath: string
  /** In Claude Code's spelling (`ccPermissionMode`). */
  readonly permissionMode: string
  /** Claude Code's workspace trust of the folder: its column of the trust table (`ClaudeSettings.trust`). */
  readonly trust: TrustSituation
  /** `/add-dir` folders, in the order they were added; their skills and commands load. */
  readonly addedDirectories?: readonly string[]
  /** `permissions.additionalDirectories`: inside the project for a hook's `if` path rules. */
  readonly additionalDirectories?: readonly string[]
  /** Claude Code's settings files of the folder, highest first (`ClaudeSettings.layers`). */
  readonly layers: readonly PolicyLayer[]
  /** Every plugin the run's catalog found. */
  readonly plugins: readonly ScopePlugin[]
  /** A sub-agent's: the chat it runs in, whose session it shares one monitor ledger with (`parentSession`). */
  readonly parentChatId?: string
  /** An `asyncRewake` hook exited 2: wake the chat with this text (the latest run's wake). */
  readonly onWake?: (text: string) => void
}

/**
 * What a run gives the kit: the host its catalog's user installs (a held one this project's own
 * hide stays, for the other projects), the session the project's own, their values, and the agent's
 * selection as a `--settings` layer, so managed settings still turn any off. That layer ranks above
 * the user, project and local files (settings.md, "Settings precedence"), so their `enabledPlugins`
 * yields to the selection, as it yields to `claude --settings`.
 */
export function sessionOwn(
  host: LocalixPluginHost,
  facts: Pick<ChatSessionFacts, 'layers' | 'plugins'>,
  held: readonly LoadedKitPlugin[] = [],
) {
  const project = facts.plugins.filter((one) => one.scope === 'project')
  host.setUserPlugins(
    facts.plugins.filter((one) => one.scope === 'user'),
    new Set(project.map((one) => one.id)),
  )
  const enabledPlugins = Object.fromEntries(facts.plugins.map((one) => [one.id, one.selected]))
  return {
    plugins: keepUnchanged(
      held,
      project.map(({ id, root, plugin }) => ({ id, root, plugin })),
    ),
    userConfig: Object.fromEntries(facts.plugins.map((one) => [one.id, one.values])),
    layers: [
      ...facts.layers,
      { scope: 'flag', settings: { enabledPlugins } } satisfies PolicyLayer,
    ],
  }
}

/**
 * The plugins a session runs, by name: those its settings select whose dependencies are met (the
 * kit turns off one whose dependency is not installed, disabled or outside its range). Their mods
 * are the ones that load.
 */
export function runningPlugins(session: Pick<PluginSession, 'plugins'>): ReadonlySet<string> {
  return new Set(session.plugins.flatMap((one) => (one.enabled ? [one.name] : [])))
}

/**
 * The errors the kit reports against a session's plugins, under each plugin's id (a dependency not
 * installed, disabled or outside its range: the plugin stays off). The plugin records show them.
 */
export function pluginErrors(
  session: Pick<PluginSession, 'plugins' | 'issues'>,
): ReadonlyMap<string, string> {
  const ids = new Set(session.plugins.map((one) => one.id))
  const errors = new Map<string, string>()
  for (const { severity, path, message } of session.issues)
    if (severity === 'error' && ids.has(path) && !errors.has(path)) errors.set(path, message)
  return errors
}

/** The locations of a session: its project, and its own plugins' folders before the host's. */
export function sessionLocations(
  host: LocalixPluginHost,
  cwd: string,
  plugins: readonly LoadedKitPlugin[],
): Locations {
  const { locations } = host.ports.host
  const roots = new Map(plugins.map((one) => [one.id, one.root]))
  return {
    ...locations,
    projectDir: () => cwd,
    pluginRoot: (id) => roots.get(id) ?? locations.pluginRoot(id),
  }
}

/**
 * A kit session on a run's own plugins, values and settings (`sessionOwn`) under Localix's tool
 * names: the one opener of a chat's session and of a scope's outside any chat (`./scope-session`).
 * `homeDir`, given, is the home its user files are read from.
 */
/**
 * What a session's hooks may run in the folder's column of the trust table: its settings files'
 * hooks (`trusted`, a parent folder's trust counting), and a project subagent's frontmatter hooks,
 * only once the dialog was accepted for the folder itself (`folderTrustAccepted`; hooks.md, "Hooks in
 * skills and agents").
 */
export const sessionTrust = (situation: TrustSituation) => ({
  trusted: contentApplies('settings-hooks', situation),
  folderTrustAccepted: contentApplies('subagent-frontmatter-hooks', situation),
})

export function openOwnSession(
  host: LocalixPluginHost,
  own: ReturnType<typeof sessionOwn>,
  options: Omit<SessionOptions, 'settings' | 'plugins' | 'userConfig' | 'locations' | 'toolNames'>,
  homeDir?: string,
): PluginSession {
  const locations = sessionLocations(host, options.cwd, own.plugins)
  return host.kit.openSession({
    ...options,
    settings: createPolicyView(own.layers),
    plugins: own.plugins.map(({ id, plugin }) => ({ id, plugin })),
    userConfig: own.userConfig,
    locations: homeDir === undefined ? locations : { ...locations, homeDir: () => homeDir },
    toolNames: LOCALIX_TOOL_NAMES,
  })
}

/**
 * One kit session per chat (`host.openSession`): opened at the chat's first run, the same session
 * for its later runs, each run a turn of it (`withTurn`), so its `once` keys and session hooks
 * live as long as the chat. A change of trust, of the added folders, of the settings (the files,
 * the agent's selection), of the project's own plugins or their values, which a turn cannot carry,
 * opens it again, on the monitors the one it replaces started and the skills it ran
 * (`monitorLedger`). A deleted chat is
 * forgotten (`forget`, from the runtime's session cleanup).
 */
export function createChatPluginSessions(host: LocalixPluginHost) {
  const open = new Map<
    string,
    {
      readonly key: string
      readonly own: readonly LoadedKitPlugin[]
      readonly session: PluginSession
    }
  >()
  // The wake of each chat's latest run: a session may open outside a run (a typed `/skill`).
  const wakes = new Map<string, (text: string) => void>()
  return {
    /** The chat's session as this run sees it: its folder, mode and directories. */
    forRun(facts: ChatSessionFacts): PluginSession {
      const permissionMode = normalizePermissionMode(facts.permissionMode)
      if (!permissionMode) throw new Error(`Unknown permission mode: ${facts.permissionMode}`)
      if (facts.onWake) wakes.set(facts.chatId, facts.onWake)
      const held = open.get(facts.chatId)
      const own = sessionOwn(host, facts, held?.own)
      const key = JSON.stringify([
        facts.trust,
        facts.addedDirectories ?? [],
        own.layers,
        own.userConfig,
      ])
      const turn = {
        cwd: facts.cwd,
        permissionMode,
        additionalDirectories: facts.additionalDirectories,
      }
      if (held?.key === key && samePlugins(held.own, own.plugins))
        return held.session.withTurn(turn)
      const parent = facts.parentChatId ? open.get(facts.parentChatId)?.session : undefined
      const session = openOwnSession(host, own, {
        ...turn,
        sessionId: facts.chatId,
        transcriptPath: facts.transcriptPath,
        ...sessionTrust(facts.trust),
        addedDirectories: facts.addedDirectories,
        // A sub-agent's shares its chat's ledger; a reopened chat's continues the replaced one's.
        ...(parent
          ? { parentSession: parent }
          : held
            ? { monitorLedger: held.session.monitorLedger() }
            : {}),
      })
      const { chatId } = facts
      session.onBackground((delivered) => delivered.wake && wakes.get(chatId)?.(delivered.wake))
      open.set(facts.chatId, { key, own: own.plugins, session })
      return session
    },
    get: (chatId: string): PluginSession | undefined => open.get(chatId)?.session,
    forget(chatId: string): void {
      open.delete(chatId)
      wakes.delete(chatId)
    },
  }
}

export type ChatPluginSessions = ReturnType<typeof createChatPluginSessions>
