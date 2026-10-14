import { agentTerminalOf } from '../features/terminal/agent-scope'
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
        kill: () => session.dispose(),
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
      open: async ({ userId, sessionId, agentId, cwd, command }) => {
        if (!serviceRefs.terminalService) throw new Error('terminal service unavailable')
        const session = await serviceRefs.terminalService.spawnCommand(userId, {
          sessionId,
          cwd,
          command,
        })
        recordTerminalWork(work, {
          owner: { userId, sessionId },
          agentId: agentId ?? null,
          label: command,
          terminal: session,
        })
        return { terminalId: session.id, screen: await session.screen() }
      },
      // Every action resolves through the AGENT boundary (see terminal/agent-scope.ts):
      // the service owns terminals per USER, which is right for the human panel, but an
      // agent may only touch panes bound to its own chat session. `list` already filtered
      // on chatSessionId and these four did not.
      screen: async ({ userId, sessionId, terminalId }) =>
        (await agentTerminalOf(
          serviceRefs.terminalService,
          userId,
          sessionId,
          terminalId,
        )?.screen()) ?? null,
      finalScreen: async ({ userId, sessionId, terminalId }) => {
        // The archive is the only thing this reads, and `get()` returns undefined for
        // exactly the ids the archive holds — the service deletes the live entry on exit.
        // So the previous `agentTerminalOf(...) || !get(...)` had its right operand true
        // precisely when there was something to leak: the session guard was inert when it
        // mattered, and another session's exited pane came back in full. `finalScreen`
        // itself compares only userId. Check the claim against the ARCHIVED record, which
        // still carries chatSessionId.
        if (!sessionId) return null
        const archived = serviceRefs.terminalService?.archivedTerminal(userId, terminalId)
        if (!archived || archived.chatSessionId !== sessionId) return null
        return (await serviceRefs.terminalService?.finalScreen(userId, terminalId)) ?? null
      },
      write: ({ userId, sessionId, terminalId, data }) => {
        const session = agentTerminalOf(serviceRefs.terminalService, userId, sessionId, terminalId)
        if (!session) return false
        session.write(data)
        return true
      },
      watch: ({ userId, sessionId, terminalId }, onEvent) => {
        const session = agentTerminalOf(serviceRefs.terminalService, userId, sessionId, terminalId)
        if (!session) return null
        const offData = session.subscribe(() => onEvent('output'))
        const offExit = session.onExit(() => onEvent('exit'))
        return () => {
          offData()
          offExit()
        }
      },
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
