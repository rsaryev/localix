import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import { zValidator } from '../../lib/validator'
import {
  capabilitySnapshotQuerySchema,
  capabilitySnapshotSchema,
  capabilityPermissionsQuerySchema,
  capabilityRulesSchema,
  capabilityRulesApplySchema,
  updateCapabilityRulesSchema,
  type CapabilityScope,
  type CapabilityRules,
} from './contracts'
import type { Rule } from '../agent-core/capability-rule'
import type { CapabilitySnapshotService } from './snapshot'
import type { CapabilityApplyService } from './apply'

/**
 * The capability surface, in two routes.
 *
 * `GET /snapshot` — everything a scope can do: plugins, their tools/views/
 * commands, managed agents, agent providers, MCP servers and skills, stamped
 * with the capability revision. It replaced a client-side fan-out whose results were
 * reconciled by hand and could disagree.
 *
 * `GET`/`PUT /rules` — one scope's OWN rules, switches and permissions alike. Deliberately not the composed
 * set a run evaluates: editing is always about the list a scope stores, and a screen offering
 * the composition could not say which scope a change belonged to.
 *
 * `POST /rules/apply` — a PATCH of that same list by (action, resource), for any kinds at
 * once, answering with the snapshot. It is what every switch in the UI writes. Changing what
 * a scope permits used to be five endpoints across four features, each returning its own
 * record shape, each needing a follow-up read of the snapshot it had just invalidated, and
 * each with its own idea of what "on" stored.
 *
 * What is NOT here: anything with a payload of its own — installing a plugin, writing
 * a skill, editing an MCP server's command. Those are not policy; they keep their own
 * routes, with their own validation and their own failure modes.
 *
 * Neither route carries a secret value — plugin config fields arrive masked from the
 * plugin service exactly as `GET /rpc/plugins` returns them.
 */
export interface CapabilityRoutesService {
  getSnapshot: CapabilitySnapshotService['getSnapshot']
  applyRules: CapabilityApplyService['apply']
  /** One scope's OWN rules — what it stores, not the composition a run evaluates. */
  readRules(userId: string, scope: CapabilityScope): Promise<CapabilityRules>
  writeRules(
    userId: string,
    scope: CapabilityScope,
    rules: Rule[],
    expectedRevision: number,
  ): Promise<{ scope: string; revision: number }>
}

export function createCapabilityRoutes(service: CapabilityRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app
    .get('/snapshot', zValidator('query', capabilitySnapshotQuerySchema), async (c) => {
      const { projectId, agentId } = c.req.valid('query')
      const snapshot = await service.getSnapshot({
        userId: c.get('userId'),
        projectId,
        agentId,
      })
      return c.json(capabilitySnapshotSchema.parse(snapshot), 200)
    })
    .post('/rules/apply', zValidator('json', capabilityRulesApplySchema), async (c) => {
      const snapshot = await service.applyRules(c.get('userId'), c.req.valid('json'))
      return c.json(capabilitySnapshotSchema.parse(snapshot), 200)
    })
    .get('/rules', zValidator('query', capabilityPermissionsQuerySchema), async (c) => {
      const answer = await service.readRules(c.get('userId'), c.req.valid('query'))
      return c.json(capabilityRulesSchema.parse(answer), 200)
    })
    .put('/rules', zValidator('json', updateCapabilityRulesSchema), async (c) => {
      const { rules, expectedRevision, ...scope } = c.req.valid('json')
      // Echo the scope the SERVER resolved, not the one the client sent: a handle wins over
      // a project id, and a client that guessed wrong must see where its save landed.
      const result = await service.writeRules(c.get('userId'), scope, rules, expectedRevision)
      return c.json(capabilityRulesSchema.parse({ ...result, rules }), 200)
    })

  routes.onError(defaultErrorHandler)
  return routes
}
