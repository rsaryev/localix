import { TOOL } from '../../agent-core/tool-names'
import { Hono } from 'hono'
import { z } from 'zod'
import { shellQuote, type HostRouteContext } from '@localixai/mini-app-sdk/backend'
import { zValidator } from '../../../lib/validator'
import { defaultErrorHandler } from '../../../lib/http'
import { ApiError } from '../../../lib/errors'
import { installedExternalAgents } from '../installed'
import { adapterFor } from './adapters/registry'
import { isPendingKey, pendingKeyFor } from './live/store'
import { detectLaunchKind } from './live/launch-kinds'
import { linkKeyOf, parseLinkKey } from '../shared/identity'
import type { AgentSessionsService } from './service'

export interface OwnedSessionHost {
  session(
    userId: string,
    sessionId: string,
  ): Promise<{ externalAgentProvider?: string | null; externalAgentSessionKey?: string | null }>
  cwd(userId: string, sessionId: string): Promise<string>
  terminals(userId: string): { id: string; chatSessionId?: string | null; command?: string }[]
  spawn(
    userId: string,
    sessionId: string,
    command: string,
  ): Promise<{ id: string; onExit?: (listener: (code: number) => void) => unknown }>
  reportError?: (error: unknown) => void
  remember(userId: string, sessionId: string, key: string): Promise<unknown>
}

/** Only a persisted Localix session can own this action; machine-wide history is never the roster. */
export function createOwnedAgentRoutes(
  host: OwnedSessionHost,
  agents?: AgentSessionsService,
  installed = installedExternalAgents,
) {
  const opening = new Map<string, Promise<{ terminalId: string; providerName: string }>>()
  const open = async (userId: string, sessionId: string) => {
    const session = await host.session(userId, sessionId)
    const provider = session.externalAgentProvider
    if (!provider)
      throw new ApiError(400, 'not_external_session', 'This session has no external agent.')
    const agent = (await installed()).find((candidate) => candidate.id === provider)
    if (!agent) throw new ApiError(404, 'agent_not_installed', 'This agent is not installed.')
    const existing = host
      .terminals(userId)
      .find(
        (terminal) =>
          terminal.chatSessionId === sessionId &&
          (agents?.live.get(terminal.id)?.provider === provider ||
            detectLaunchKind(terminal.command) === provider),
      )
    if (existing) return { terminalId: existing.id, providerName: agent.name }
    let command = agent.command
    if (session.externalAgentSessionKey) {
      if (isPendingKey(session.externalAgentSessionKey))
        throw new ApiError(
          409,
          'native_identity_unavailable',
          'The saved agent session has not been identified yet. Your Localix chat is still available.',
        )
      const identity = parseLinkKey(session.externalAgentSessionKey)
      const resume =
        identity?.provider === provider
          ? adapterFor(provider)?.resumeCommand?.(identity.nativeSessionId)
          : undefined
      if (!resume)
        throw new ApiError(
          409,
          'resume_unavailable',
          'This agent cannot resume the saved native session.',
        )
      command = resume
      if (agents) {
        const resolved = await agents.resume(session.externalAgentSessionKey)
        if (!resolved?.resume)
          throw new ApiError(
            404,
            'native_session_missing',
            'The saved native session is no longer available.',
          )
        command = resolved.resume.command
      }
    }
    const cwd = await host.cwd(userId, sessionId)
    const terminal = await host.spawn(userId, sessionId, command)
    if (!session.externalAgentSessionKey)
      await host.remember(userId, sessionId, pendingKeyFor(provider, terminal.id))
    if (agents) {
      terminal.onExit?.(() => agents.live.close(terminal.id))
      const unsubscribe = agents.live.onChange((entry) => {
        if (entry.terminalId !== terminal.id) return
        if (entry.nativeSessionId) {
          unsubscribe()
          void host
            .remember(
              userId,
              sessionId,
              linkKeyOf({ provider, nativeSessionId: entry.nativeSessionId }),
            )
            .catch((error) => host.reportError?.(error))
        } else if (entry.closed) unsubscribe()
      })
      agents.handleToolCall({
        toolName: TOOL.Bash,
        sessionId,
        input: { action: 'open' },
        result: {
          content: '',
          details: {
            action: 'open',
            terminalId: terminal.id,
            command: `LOCALIX_AGENT=${provider} LOCALIX_AGENT_CWD=${shellQuote(cwd)} ${command}`,
          },
        },
      })
      const native =
        session.externalAgentSessionKey && parseLinkKey(session.externalAgentSessionKey)
      if (native) agents.live.adopt(terminal.id, native.nativeSessionId)
    }
    return { terminalId: terminal.id, providerName: agent.name }
  }
  const app = new Hono<HostRouteContext>().post(
    '/open-owned',
    zValidator('json', z.object({ sessionId: z.string().min(1).max(200) })),
    async (c) => {
      const userId = c.get('userId')
      const { sessionId } = c.req.valid('json')
      const key = JSON.stringify([userId, sessionId])
      let pending = opening.get(key)
      if (!pending) {
        pending = open(userId, sessionId).finally(() => opening.delete(key))
        opening.set(key, pending)
      }
      return c.json(await pending)
    },
  )
  app.onError(defaultErrorHandler)
  return app
}
