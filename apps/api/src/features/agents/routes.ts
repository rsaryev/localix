import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '../../lib/validator'

import { defaultErrorHandler } from '../../lib/http'
import { ApiError } from '../../lib/errors'
import type { AppContext } from '../../app'
import {
  publishRegistrationPolicySchema,
  type createRegistrationPolicyService,
} from './registration-policy'
import { contributionReadErrorSchema, type ContributionReadError } from '../ext/contribution-reader'
import {
  agentRecordInputSchema,
  agentRecordSchema,
  agentScopeQuerySchema,
  agentSummarySchema,
  duplicateAgentRequestSchema,
  type AgentRecord,
  type AgentRecordInput,
  type AgentSummary,
} from './contracts'

/**
 * Managed-Agents registry routes (`/rpc/agents`), mounted near `/rpc/plugins`.
 * Ownership-gated by userId (the app middleware sets it). CRUD over the
 * file-backed registry + its `agents` ext-state enable rows. Listing and the enable
 * toggle live on the capability endpoints; the per-name routes here carry the scope as
 * a `projectId` query parameter because the same name may exist globally AND in a project.
 */
export interface AgentsRoutesService {
  registrationPolicy: ReturnType<typeof createRegistrationPolicyService>
  listRegistrationDiagnostics(
    userId: string,
    projectId?: string | null,
  ): Promise<ContributionReadError[]>
  getAgent(userId: string, name: string, projectId?: string | null): Promise<AgentSummary | null>
  createAgent(userId: string, input: AgentRecordInput): Promise<AgentSummary>
  updateAgent(
    userId: string,
    name: string,
    input: AgentRecordInput,
    projectId?: string | null,
  ): Promise<AgentSummary>
  deleteAgent(userId: string, name: string, projectId?: string | null): Promise<void>
  resetAgent(userId: string, name: string): Promise<AgentSummary>
  agentDefaults(name: string): AgentRecord | null
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
    .get(
      '/:name/policy-review',
      zValidator('param', nameParamSchema),
      zValidator('query', agentScopeQuerySchema),
      async (c) => {
        return c.json(
          await service.registrationPolicy.review(
            c.get('userId'),
            c.req.valid('query').projectId ?? '',
            c.req.valid('param').name,
          ),
        )
      },
    )
    .put(
      '/:name/policy-review',
      zValidator('param', nameParamSchema),
      zValidator('query', agentScopeQuerySchema),
      zValidator('json', publishRegistrationPolicySchema),
      async (c) => {
        return c.json(
          await service.registrationPolicy.publish(
            c.get('userId'),
            c.req.valid('query').projectId ?? '',
            c.req.valid('param').name,
            c.req.valid('json'),
          ),
        )
      },
    )
    .get('/registry/diagnostics', zValidator('query', agentScopeQuerySchema), async (c) => {
      const diagnostics = await service.listRegistrationDiagnostics(
        c.get('userId'),
        c.req.valid('query').projectId,
      )
      return c.json({ diagnostics: z.array(contributionReadErrorSchema).parse(diagnostics) })
    })
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
    // Read-only, and deliberately not a variant of `/reset`: the editor asks for the shipped
    // definition to PUT IN ITS FIELDS, and the user still decides by saving. Removing the
    // override is what the save does.
    .get('/:name/defaults', zValidator('param', nameParamSchema), async (c) => {
      const record = service.agentDefaults(c.req.valid('param').name)
      if (!record) throw new ApiError(404, 'agent_not_builtin', 'This agent ships no default.')
      return c.json(agentRecordSchema.parse(record), 200)
    })
    .post('/:name/reset', zValidator('param', nameParamSchema), async (c) => {
      const summary = await service.resetAgent(c.get('userId'), c.req.valid('param').name)
      return c.json(agentSummarySchema.parse(summary), 200)
    })
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
