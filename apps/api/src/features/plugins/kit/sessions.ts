import {
  normalizePermissionMode,
  type Locations,
  type OptionValues,
  type PluginSession,
} from '@rsaryev/llx-plugin'
import { createPolicyView, type PolicyLayer } from '@rsaryev/llx-plugin/settings'
import { keepUnchanged, samePlugins, type LoadedKitPlugin, type LocalixPluginHost } from './host'

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
  /** Claude Code's workspace trust of the folder (`claudeCodeTrusts`). */
  readonly trusted: boolean
  /** `/add-dir` folders, in the order they were added; their skills and commands load. */
  readonly addedDirectories?: readonly string[]
  /** `permissions.additionalDirectories`: inside the project for a hook's `if` path rules. */
  readonly additionalDirectories?: readonly string[]
  /** Claude Code's settings files of the folder, highest first (`ClaudeSettings.layers`). */
  readonly layers: readonly PolicyLayer[]
  /** Every plugin the run's catalog found. */
  readonly plugins: readonly ScopePlugin[]
  /** An `asyncRewake` hook exited 2: wake the chat with this text (the latest run's wake). */
  readonly onWake?: (text: string) => void
}

/**
 * What a run gives the kit: the host its catalog's user installs (a held one this project's own
 * hide stays, for the other projects), the session the project's own, their values, and the agent's
 * selection as a `--settings` layer, so managed settings still turn any off.
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
 * One kit session per chat (`host.openSession`): opened at the chat's first run, the same session
 * for its later runs, each run a turn of it (`withTurn`), so its `once` keys and session hooks
 * live as long as the chat. A change of trust, of the added folders, of the settings (the files,
 * the agent's selection), of the project's own plugins or their values, which a turn cannot carry,
 * opens it again. A deleted chat is
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
        facts.trusted,
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
      const session = host.kit.openSession({
        ...turn,
        sessionId: facts.chatId,
        transcriptPath: facts.transcriptPath,
        trusted: facts.trusted,
        addedDirectories: facts.addedDirectories,
        settings: createPolicyView(own.layers),
        plugins: own.plugins.map(({ id, plugin }) => ({ id, plugin })),
        userConfig: own.userConfig,
        locations: sessionLocations(host, facts.cwd, own.plugins),
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
