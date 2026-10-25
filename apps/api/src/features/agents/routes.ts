import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../lib/validator'

import { defaultErrorHandler } from '../../lib/http'
import { ApiError } from '../../lib/errors'
import type { AppContext } from '../../app'
import {
  agentRecordInputSchema,
  agentScopeQuerySchema,
  agentSummarySchema,
  duplicateAgentRequestSchema,
  type AgentRecordInput,
  type AgentSummary,
} from './contracts'

/**
 * Agent routes (`/rpc/agents`), mounted near `/rpc/plugins`.
 * Ownership-gated by userId (the app middleware sets it). CRUD over the Claude Code agent files.
 * Listing and the enable toggle live on the capability endpoints; the per-name routes here carry
 * the scope as a `projectId` query parameter because the same name may exist for the person AND in
 * a project.
 */
export interface AgentsRoutesService {
  getAgent(userId: string, name: string, projectId?: string | null): Promise<AgentSummary | null>
  createAgent(userId: string, input: AgentRecordInput): Promise<AgentSummary>
  updateAgent(
    userId: string,
    name: string,
    input: AgentRecordInput,
    projectId?: string | null,
  ): Promise<AgentSummary>
  deleteAgent(userId: string, name: string, projectId?: string | null): Promise<void>
  duplicateAgent(
    userId: string,
    name: string,
    newName: string,
    projectId?: string | null,
  ): Promise<AgentSummary>
}

const nameParamSchema = z.object({ name: z.string().min(1) })

export function createAgentsRoutes(service: AgentsRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app
    .post('/', zValidator('json', agentRecordInputSchema), async (c) => {
      const summary = await service.createAgent(c.get('userId'), c.req.valid('json'))
      return c.json(agentSummarySchema.parse(summary), 201)
    })
    .get(
      '/:name',
      zValidator('param', nameParamSchema),
      zValidator('query', agentScopeQuerySchema),
      async (c) => {
        const { name } = c.req.valid('param')
        const { projectId } = c.req.valid('query')
        const summary = await service.getAgent(c.get('userId'), name, projectId ?? null)
        if (!summary) throw new ApiError(404, 'agent_not_found', 'Agent not found')
        return c.json(agentSummarySchema.parse(summary), 200)
      },
    )
    .put(
      '/:name',
      zValidator('param', nameParamSchema),
      zValidator('query', agentScopeQuerySchema),
      zValidator('json', agentRecordInputSchema),
      async (c) => {
        const { name } = c.req.valid('param')
        const { projectId } = c.req.valid('query')
        const summary = await service.updateAgent(
          c.get('userId'),
          name,
          c.req.valid('json'),
          projectId ?? null,
        )
        return c.json(agentSummarySchema.parse(summary), 200)
      },
    )
    .delete(
      '/:name',
      zValidator('param', nameParamSchema),
      zValidator('query', agentScopeQuerySchema),
      async (c) => {
        const { name } = c.req.valid('param')
        const { projectId } = c.req.valid('query')
        await service.deleteAgent(c.get('userId'), name, projectId ?? null)
        return c.body(null, 204)
      },
    )
    .post(
      '/:name/duplicate',
      zValidator('param', nameParamSchema),
      zValidator('json', duplicateAgentRequestSchema),
      async (c) => {
        const { name } = c.req.valid('param')
        const body = c.req.valid('json')
        const summary = await service.duplicateAgent(
          c.get('userId'),
          name,
          body.name,
          body.projectId ?? null,
        )
        return c.json(agentSummarySchema.parse(summary), 201)
      },
    )

  routes.onError(defaultErrorHandler)

  return routes
}
