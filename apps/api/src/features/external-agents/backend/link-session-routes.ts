import { Hono } from 'hono'
import { z } from 'zod'
import type { HostRouteContext } from '@localixai/mini-app-sdk/backend'
import type { SessionDetail } from '../../chat/contracts'
import { zValidator } from '../../../lib/validator'
import { defaultErrorHandler } from '../../../lib/http'
import { ApiError } from '../../../lib/errors'
import { installedExternalAgents } from '../installed'

export interface LinkSessionHost {
  session(userId: string, sessionId: string): Promise<SessionDetail>
  link(userId: string, sessionId: string, provider: string): Promise<SessionDetail>
}

/** A linked CLI belongs to an existing normal chat; linking never creates or imports one. */
export function createLinkAgentRoutes(host: LinkSessionHost, installed = installedExternalAgents) {
  const pending = new Map<string, Promise<SessionDetail>>()
  const link = async (userId: string, sessionId: string, provider: string) => {
    const session = await host.session(userId, sessionId)
    if (session.sessionKind !== 'chat')
      throw new ApiError(400, 'not_chat_session', 'Only an ordinary chat can have a linked agent.')
    if (session.externalAgentProvider) {
      if (session.externalAgentProvider !== provider)
        throw new ApiError(409, 'agent_already_linked', 'This chat already has a linked agent.')
      return session
    }
    if (!(await installed()).some((agent) => agent.id === provider))
      throw new ApiError(404, 'agent_not_installed', 'This agent is not installed.')
    return host.link(userId, sessionId, provider)
  }
  const app = new Hono<HostRouteContext>().post(
    '/link-agent',
    zValidator(
      'json',
      z.object({
        sessionId: z.string().min(1).max(200),
        provider: z.string().min(1).max(64),
      }),
    ),
    async (c) => {
      const userId = c.get('userId')
      const { sessionId, provider } = c.req.valid('json')
      const key = JSON.stringify([userId, sessionId])
      const previous = pending.get(key) ?? Promise.resolve()
      const current = previous.catch(() => {}).then(() => link(userId, sessionId, provider))
      pending.set(key, current)
      try {
        return c.json(await current)
      } finally {
        if (pending.get(key) === current) pending.delete(key)
      }
    },
  )
  app.onError(defaultErrorHandler)
  return app
}
