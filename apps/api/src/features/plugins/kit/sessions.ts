import { normalizePermissionMode, type PluginSession } from '@rsaryev/llx-plugin'
import type { LocalixPluginHost } from './host'

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
}

/**
 * One kit session per chat (`host.openSession`): opened at the chat's first run, the same session
 * for its later runs, each run a turn of it (`withTurn`), so its `once` keys and session hooks
 * live as long as the chat. A change of trust or of the added folders, which a turn cannot carry,
 * opens it again. A deleted chat is forgotten (`forget`, from the runtime's session cleanup).
 */
export function createChatPluginSessions(host: LocalixPluginHost) {
  const open = new Map<string, { readonly key: string; readonly session: PluginSession }>()
  return {
    /** The chat's session as this run sees it: its folder, mode and directories. */
    forRun(facts: ChatSessionFacts): PluginSession {
      const permissionMode = normalizePermissionMode(facts.permissionMode)
      if (!permissionMode) throw new Error(`Unknown permission mode: ${facts.permissionMode}`)
      const key = JSON.stringify([facts.trusted, facts.addedDirectories ?? []])
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
