import { normalizePermissionMode, type PluginSession } from '@rsaryev/llx-plugin'
import { createPolicyView, type PolicyLayer } from '@rsaryev/llx-plugin/settings'
import type { LoadedKitPlugin, LocalixPluginHost } from './host'

/** A plugin of the run's catalog, with whether the run's agent may use it (`capability_rule`, trust). */
export interface ScopePlugin extends LoadedKitPlugin {
  readonly selected: boolean
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
  /** The catalog's scope (project and folder) and every plugin it found there. */
  readonly scope: string
  readonly plugins: readonly ScopePlugin[]
}

/**
 * The session's settings: the folder's files, and the agent's selection as a `--settings` layer
 * that names every plugin the host holds, so one the run's catalog did not select (another
 * project's, or one its rules refuse) is off and managed settings still turn any off.
 */
function sessionSettings(host: LocalixPluginHost, facts: ChatSessionFacts) {
  const selected = new Set(facts.plugins.filter((one) => one.selected).map((one) => one.id))
  const enabledPlugins = Object.fromEntries(
    host.plugins().map(({ id }) => [id, selected.has(id)] as const),
  )
  return [...facts.layers, { scope: 'flag', settings: { enabledPlugins } } satisfies PolicyLayer]
}

/**
 * One kit session per chat (`host.openSession`): opened at the chat's first run, the same session
 * for its later runs, each run a turn of it (`withTurn`), so its `once` keys and session hooks
 * live as long as the chat. Each run first gives the host its catalog's plugins (`feedScope`).
 * A change of trust, of the added folders or of the settings (the files, the agent's selection,
 * the plugins the host holds), which a turn cannot carry, opens it again. A deleted chat is
 * forgotten (`forget`, from the runtime's session cleanup).
 */
export function createChatPluginSessions(host: LocalixPluginHost) {
  const open = new Map<string, { readonly key: string; readonly session: PluginSession }>()
  return {
    /** The chat's session as this run sees it: its folder, mode and directories. */
    forRun(facts: ChatSessionFacts): PluginSession {
      const permissionMode = normalizePermissionMode(facts.permissionMode)
      if (!permissionMode) throw new Error(`Unknown permission mode: ${facts.permissionMode}`)
      host.feedScope(
        facts.scope,
        facts.plugins.map(({ id, root, plugin }) => ({ id, root, plugin })),
      )
      const layers = sessionSettings(host, facts)
      const key = JSON.stringify([facts.trusted, facts.addedDirectories ?? [], layers])
      const turn = {
        cwd: facts.cwd,
        permissionMode,
        additionalDirectories: facts.additionalDirectories,
      }
      const held = open.get(facts.chatId)
      if (held?.key === key) return held.session.withTurn(turn)
      const project = facts.cwd
      const session = host.kit.openSession({
        ...turn,
        sessionId: facts.chatId,
        transcriptPath: facts.transcriptPath,
        trusted: facts.trusted,
        addedDirectories: facts.addedDirectories,
        settings: createPolicyView(layers),
        hookPorts: { locations: { ...host.ports.host.locations, projectDir: () => project } },
      })
      open.set(facts.chatId, { key, session })
      return session
    },
    get: (chatId: string): PluginSession | undefined => open.get(chatId)?.session,
    forget(chatId: string): void {
      open.delete(chatId)
    },
  }
}

export type ChatPluginSessions = ReturnType<typeof createChatPluginSessions>
