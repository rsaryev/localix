import { agentTerminalOf, agentTerminalReader } from '../features/terminal/agent-scope'
import { stripAnsi } from '../features/terminal/scrollback-digest'
import { recordTerminalWork } from '../features/terminal/terminal-work'
import type { ChatServiceDeps } from '../features/chat/service/context'
import type { WorkRegistry } from '../features/work/registry'
import type { BootstrapServiceRefs } from './chat-service-deps'

/**
 * The chat runtime's four ports onto the terminal service: PTY-backed background jobs, their
 * scrollback, the agent's interactive `terminal` tool, and the session-deletion sweep.
 *
 * The terminal service is FORWARD-HELD (`serviceRefs.terminalService`): it is built after the chat
 * service, which it needs for cwd resolution, so every port reads it at call time. Split out of
 * `chat-service-deps.ts` because it is one self-contained unit — every member closes over that
 * one reference, and the work registry an interactive pane is recorded in.
 */
export function createTerminalPorts(
  serviceRefs: BootstrapServiceRefs,
  work: WorkRegistry,
): Pick<
  ChatServiceDeps,
  'spawnTerminalJob' | 'readTerminalJob' | 'terminalControl' | 'closeSessionTerminals'
> {
  const agentTerminal = agentTerminalReader(() => serviceRefs.terminalService)
  return {
    spawnTerminalJob: async ({ userId, sessionId, cwd, command, wakesAgent }) => {
      if (!serviceRefs.terminalService) throw new Error('terminal service unavailable')
      const session = await serviceRefs.terminalService.spawnCommand(userId, {
        sessionId,
        cwd,
        command,
        wakesAgent,
      })
      return {
        terminalId: session.id,
        onData: (...args) => {
          session.subscribe(...args)
        },
        onExit: (...args) => {
          session.onExit(...args)
        },
        onPreviewUrl: (...args) => {
          session.onPreviewUrl(...args)
        },
        write: (...args) => session.write(...args),
        // Through the service's `close`, not `session.dispose()`: a job the agent, the person or
        // a timeout stopped is a stop, and only `close` marks the exit so. Disposed directly, the
        // pane's synthetic 130 reached the person as "Background terminal exited (130)".
        kill: (reason) => {
          if (!serviceRefs.terminalService?.close(userId, session.id, reason)) session.dispose()
        },
      }
    },
    // Plain text, because both readers hand it to the model (the `# Background jobs` tail and
    // `jobs read`): raw scrollback is colour codes for a dev server and escape soup for the
    // full-screen program an interactive pane runs.
    readTerminalJob: ({ userId, terminalId }) => {
      const session = serviceRefs.terminalService?.get(userId, terminalId)
      return session ? { output: stripAnsi(session.replay), running: true } : null
    },
    // Drives the interactive `terminal` tool: a thin, ownership-checked wrapper over the
    // terminal service. open()/screen() spin the VT emulator up lazily, so non-interactive
    // bash and jobs panes never pay for it.
    terminalControl: {
      open: async ({ userId, sessionId, cwd, command }) => {
        if (!serviceRefs.terminalService) throw new Error('terminal service unavailable')
        const session = await serviceRefs.terminalService.spawnCommand(userId, {
          sessionId,
          cwd,
          command,
        })
        recordTerminalWork(work, {
          owner: { userId, sessionId },
          label: command,
          terminal: session,
        })
        return { terminalId: session.id, screen: await session.screen() }
      },
      // Every action resolves through the AGENT boundary (see terminal/agent-scope.ts):
      // the service owns terminals per USER, which is right for the human panel, but an
      // agent may only touch panes bound to its own chat session. `list` already filtered
      // on chatSessionId and these four did not.
      // An exited pane's final screen is checked against its ARCHIVED record (agent-scope.ts).
      screen: agentTerminal.screen,
      finalScreen: agentTerminal.finalScreen,
      write: ({ userId, sessionId, terminalId, data }) => {
        const session = agentTerminalOf(serviceRefs.terminalService, userId, sessionId, terminalId)
        if (!session) return false
        session.write(data)
        return true
      },
      watch: agentTerminal.watch,
      list: ({ userId, sessionId }) =>
        (serviceRefs.terminalService?.list(userId) ?? []).flatMap((t) =>
          t.chatSessionId === sessionId ? [{ terminalId: t.id, command: t.command }] : [],
        ),
      close: ({ userId, sessionId, terminalId }) =>
        agentTerminalOf(serviceRefs.terminalService, userId, sessionId, terminalId)
          ? (serviceRefs.terminalService?.close(userId, terminalId) ?? false)
          : false,
    },
    closeSessionTerminals: (...args) => {
      serviceRefs.terminalService?.closeForSession(...args)
    },
  }
}
