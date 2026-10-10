/**
 * Terminal service: owns the live {@link TerminalSession} registry, scoped per
 * user. Creation resolves a working directory through an injected resolver so the
 * feature never imports chat internals — the dependency arrow stays one-way.
 */
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { TerminalSession, type TerminalSessionInfo } from './session'
import { createTerminalPreview } from './service-preview'
import { installShellIntegration, cleanupShellIntegration } from './shell-integration'
import type { CreateTerminalInput, TerminalServiceDeps } from './service-deps'
import { hasUserInput } from './input-activity'

/** xterm emits ordinary typing one character/frame at a time. Lifecycle events are
 * transcript activity, not an input audit log, so publish at most one marker for
 * one contiguous typing burst instead of flooding every realtime subscriber. */
const USER_INPUT_ACTIVITY_WINDOW_MS = 500
/** A wait re-renders on output, and a render is async (the emulator drains first), so a
 *  short-lived process can print its answer and exit before that render reads the live
 *  session. Keep only a small, short-lived archive of finished sessions for its final screen. */
const FINAL_SCREEN_TTL_MS = 30_000
const FINAL_SCREEN_LIMIT = 16

const clampDim = (v: number | undefined, fallback: number) =>
  Number.isFinite(v) && (v as number) > 0 ? Math.min(Math.floor(v as number), 1000) : fallback

export function createTerminalService(deps: TerminalServiceDeps) {
  const sessions = new Map<string, TerminalSession>()
  const exitedSessions = new Map<string, { session: TerminalSession; expiresAt: number }>()
  const lastUserInputActivity = new Map<string, number>()
  const stoppedTerminals = new Set<string>()
  const preview = createTerminalPreview(sessions, deps)

  const pruneExitedSessions = (now = Date.now()) => {
    for (const [id, entry] of exitedSessions) {
      if (entry.expiresAt <= now) exitedSessions.delete(id)
    }
    while (exitedSessions.size > FINAL_SCREEN_LIMIT) {
      const oldest = exitedSessions.keys().next().value
      if (oldest === undefined) break
      exitedSessions.delete(oldest)
    }
  }

  const archiveExitedSession = (session: TerminalSession) => {
    exitedSessions.delete(session.id)
    exitedSessions.set(session.id, {
      session,
      expiresAt: Date.now() + FINAL_SCREEN_TTL_MS,
    })
    pruneExitedSessions()
  }

  const ownedBy = (userId: string, id: string): TerminalSession | undefined => {
    const s = sessions.get(id)
    return s?.userId === userId ? s : undefined
  }

  const createSession = (
    userId: string,
    cwd: string,
    input: {
      cols?: number
      rows?: number
      command?: string
      chatSessionId?: string | null
      wakesAgent?: boolean
    },
  ) => {
    const id = randomUUID()
    // Interactive panes get OSC 133 shell integration; one-shot command panes
    // don't need per-command marks. Opt-out safe: an unknown shell or any failure
    // leaves `injection` null → a plain shell.
    const shell = deps.shell ?? process.env.SHELL
    let injection: ReturnType<typeof installShellIntegration> = null
    if (!input.command && deps.shellIntegration !== false) {
      try {
        injection = installShellIntegration(shell)
      } catch {
        injection = null
      }
    }
    let session: TerminalSession
    try {
      session = new TerminalSession({
        id,
        userId,
        cwd,
        cols: clampDim(input.cols, 80),
        rows: clampDim(input.rows, 24),
        backend: deps.backend,
        onExit: (sid, exitCode) => {
          const exited = sessions.get(sid)
          const stopped = stoppedTerminals.delete(sid)
          // Read the URL BEFORE archiving: the process that served it is gone, and this is
          // the earliest anyone can know it.
          const servedUrl = exited?.info.previewUrl
          if (servedUrl) deps.reportEndpointLiveness?.(servedUrl, false)
          if (exited) archiveExitedSession(exited)
          sessions.delete(sid)
          lastUserInputActivity.delete(sid)
          if (input.chatSessionId) {
            deps.publishLifecycle?.(userId, input.chatSessionId, {
              type: 'terminal.finished',
              terminalId: sid,
              exitCode,
              command: input.command,
              cwd,
              finishedAt: Date.now(),
              ...(stopped ? { stopped: true as const } : {}),
              // No command = the login shell `open` gives the person; they typed `exit` themselves.
              ...(input.command ? {} : { interactive: true as const }),
              ...(input.wakesAgent ? { wakesAgent: true as const } : {}),
            })
          }
        },
        command: input.command,
        chatSessionId: input.chatSessionId,
        shell: injection ? shell : undefined,
        shellArgs: injection?.shellArgs,
        env: injection?.env,
        cleanup: injection ? () => cleanupShellIntegration(injection?.dir) : undefined,
        onStateChange: (sid) => {
          const live = sessions.get(sid)
          if (!live || !input.chatSessionId) return
          const { altScreen, previewUrl, command } = live.info
          deps.publishState?.(userId, input.chatSessionId, {
            type: 'terminal.state',
            terminalId: sid,
            altScreen,
            ...(command ? { command } : {}),
            ...(previewUrl ? { previewUrl } : {}),
          })
        },
      })
    } catch (err) {
      // Crumple-zone release (Release It! — a failure must not leak a resource):
      // the shell-integration temp dir is already on disk, but if the PTY spawn
      // throws in the constructor the session never wires its `cleanup`, so nothing
      // would ever reap those files. Reclaim them here before rethrowing.
      if (injection) cleanupShellIntegration(injection.dir)
      throw err
    }
    sessions.set(id, session)
    return session
  }

  return {
    async open(userId: string, input: CreateTerminalInput): Promise<TerminalSessionInfo> {
      const workspaceCwd = await deps.resolveCwd(userId, input.sessionId)
      const cwd = resolve(workspaceCwd, input.cwd ?? '.')
      return createSession(userId, cwd, {
        ...input,
        chatSessionId: input.sessionId,
      }).info
    },

    /**
     * Launch a one-shot command in a PTY pane (agent task panes). Returns the live
     * session so the caller can stream output / observe exit / write input / kill.
     * The UI learns of the pane through the agent's background-job item (which
     * carries the returned terminalId), so no separate spawn notification is needed.
     */
    async spawnCommand(
      userId: string,
      input: {
        /** Required for the same reason as {@link CreateTerminalInput.sessionId}. */
        sessionId: string
        cwd?: string
        command: string
        cols?: number
        rows?: number
        /** The agent asked to be woken by this job's exit (`bash notify`). */
        wakesAgent?: boolean
      },
    ): Promise<TerminalSession> {
      const workspaceCwd = await deps.resolveCwd(userId, input.sessionId)
      const cwd = resolve(workspaceCwd, input.cwd ?? '.')
      return createSession(userId, cwd, {
        cols: input.cols,
        rows: input.rows,
        command: input.command,
        chatSessionId: input.sessionId,
        wakesAgent: input.wakesAgent,
      })
    },

    /** Returns the session only when it exists AND belongs to the caller. */
    get(userId: string, id: string): TerminalSession | undefined {
      return ownedBy(userId, id)
    },

    /**
     * Read the bounded post-exit archive without weakening live ownership
     * semantics: get()/list()/write() continue to treat this terminal as closed.
     */
    /**
     * The ARCHIVED session behind a post-exit id, for callers that must check more than
     * user ownership. `get`/`list`/`write` deliberately treat an exited terminal as gone,
     * which left the agent boundary with nothing to check: after exit the live entry is
     * deleted, so a `get()`-based guard passed for exactly the ids the archive holds. The
     * archived record still carries `chatSessionId`, so the agent wiring can confine the
     * archive the same way it confines a live pane.
     */
    archivedTerminal(userId: string, id: string): TerminalSession | undefined {
      pruneExitedSessions()
      const entry = exitedSessions.get(id)
      return entry?.session.userId === userId ? entry.session : undefined
    },

    async finalScreen(userId: string, id: string) {
      pruneExitedSessions()
      const entry = exitedSessions.get(id)
      if (!entry || entry.session.userId !== userId) return null
      return entry.session.screen()
    },

    /** Client input includes VT protocol replies; publish activity only for actual user input. */
    writeUserInput(userId: string, id: string, data: string): boolean {
      const session = ownedBy(userId, id)
      if (!session) return false
      session.write(data)
      if (!hasUserInput(data)) return true
      const now = performance.now()
      const lastActivity = lastUserInputActivity.get(id)
      if (
        session.chatSessionId &&
        (lastActivity === undefined || now - lastActivity >= USER_INPUT_ACTIVITY_WINDOW_MS)
      ) {
        lastUserInputActivity.set(id, now)
        deps.publishLifecycle?.(userId, session.chatSessionId, {
          type: 'terminal.input',
          terminalId: id,
          source: 'user',
          label: 'user input',
        })
      }
      return true
    },

    list(userId: string): TerminalSessionInfo[] {
      return [...sessions.values()].flatMap((s) => (s.userId === userId ? [s.info] : []))
    },

    ...preview,

    close(userId: string, id: string): boolean {
      const session = ownedBy(userId, id)
      if (!session) return false
      stoppedTerminals.add(id)
      session.dispose()
      // TerminalSession.dispose() synchronously runs the same authoritative
      // onExit path as a natural exit. Keep these deletes as defensive no-ops for
      // custom/future implementations, not as a second lifecycle owner.
      sessions.delete(id)
      lastUserInputActivity.delete(id)
      return true
    },

    /** Kill every PTY bound to a chat session (that session was deleted). */
    closeForSession(userId: string, chatSessionId: string): number {
      let closed = 0
      for (const [id, s] of sessions) {
        if (s.userId === userId && s.chatSessionId === chatSessionId) {
          s.dispose()
          sessions.delete(id)
          lastUserInputActivity.delete(id)
          closed += 1
        }
      }
      return closed
    },

    /** Tear down every live PTY (server shutdown). */
    disposeAll(): void {
      for (const s of sessions.values()) s.dispose()
      sessions.clear()
      exitedSessions.clear()
      lastUserInputActivity.clear()
    },
  }
}

export type TerminalService = ReturnType<typeof createTerminalService>
