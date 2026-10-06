import { isPathWithin } from '@localixai/path-containment'
import { Hono } from 'hono'
import { z } from 'zod'
import type { HostRouteContext } from '@localixai/plugin-sdk/backend'
import { zValidator } from '../../../lib/validator'
import { defaultErrorHandler } from '../../../lib/http'
import { ApiError } from '../../../lib/errors'
import type { SessionSummary } from '../shared/contracts'
import { adapterFor } from './adapters/registry'

export interface AttachSessionHost {
  native(key: string): Promise<SessionSummary | null>
  sessions(userId: string): Promise<{
    sessions: readonly {
      id: string
      projectId: string
      externalAgentSessionKey?: string | null
    }[]
  }>
  project(userId: string, id: string): Promise<{ id: string; workingDir: string }>
  resolveProject(userId: string, cwd: string): Promise<{ id: string }>
  create(
    userId: string,
    input: {
      title: string
      projectId?: string
      externalAgentProvider: string
      externalAgentSessionKey: string
      externalAgentHistory: { startedAt?: number; updatedAt: number }
    },
  ): Promise<{ id: string; projectId: string }>
}

/** Attach identity only: native messages stay in the CLI's history. */
export function createAttachAgentRoutes(host: AttachSessionHost) {
  const opening = new Map<string, Promise<{ sessionId: string; projectId: string }>>()
  const attach = async (userId: string, key: string, projectId?: string) => {
    const source = await host.native(key)
    if (!source)
      throw new ApiError(
        404,
        'native_session_missing',
        'This native session is no longer available.',
      )
    if (!adapterFor(source.provider)?.resumeCommand)
      throw new ApiError(
        409,
        'resume_unavailable',
        'This agent cannot resume the selected session.',
      )
    if (projectId) {
      const project = await host.project(userId, projectId)
      if (!source.cwd || !isPathWithin(project.workingDir, source.cwd))
        throw new ApiError(
          400,
          'native_scope_mismatch',
          'This session belongs to a different directory.',
        )
    }
    const { sessions } = await host.sessions(userId)
    const existing = sessions.find((session) => session.externalAgentSessionKey === key)
    if (existing) return { sessionId: existing.id, projectId: existing.projectId }
    const project =
      projectId ?? (source.cwd ? (await host.resolveProject(userId, source.cwd)).id : undefined)
    const created = await host.create(userId, {
      title: source.title || source.nativeSessionId,
      ...(project ? { projectId: project } : {}),
      externalAgentProvider: source.provider,
      externalAgentSessionKey: source.key,
      externalAgentHistory: { startedAt: source.startedAt, updatedAt: source.updatedAt },
    })
    return { sessionId: created.id, projectId: created.projectId }
  }
  const app = new Hono<HostRouteContext>().post(
    '/attach-native',
    zValidator(
      'json',
      z.object({
        key: z.string().min(3).max(400),
        projectId: z.string().min(1).max(200).optional(),
      }),
    ),
    async (c) => {
      const userId = c.get('userId')
      const { key, projectId } = c.req.valid('json')
      const flightKey = JSON.stringify([userId, key])
      let pending = opening.get(flightKey)
      if (!pending) {
        pending = attach(userId, key, projectId).finally(() => opening.delete(flightKey))
        opening.set(flightKey, pending)
      }
      return c.json(await pending)
    },
  )
  app.onError(defaultErrorHandler)
  return app
}
