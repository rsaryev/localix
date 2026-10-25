import type { StoreToolPort } from '../../../agent-core/tools/store'
import { isToolDirect } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import type { RuntimeToolWiringContext, buildRunToolRegistry } from './runtime-tools'

/**
 * Host wiring for the `store` tool: the Store service, bound to this run's person and open
 * project. Root chat only (`policy.lineage`), like the agent management it replaces; a model never
 * names the user, the project or a source. The tool reads only what the person's added sources
 * list: the port has no way to add, remove or refresh one.
 */
export function buildStoreOptions(
  ctx: RuntimeToolWiringContext,
  params: Parameters<typeof buildRunToolRegistry>[1],
): StoreToolPort | undefined {
  const { userId, session, agentProfile } = params
  const service = ctx.deps.store
  if (!service || !params.policy.lineage.managesAgents || !isToolDirect(agentProfile, TOOL.store))
    return undefined
  const actor = { userId, projectId: session.projectId ?? null }
  return {
    async search({ query, kind, installed, limit }) {
      const page = await service.listings(actor, {
        ...(query?.trim() ? { q: query.trim() } : {}),
        ...(kind ? { shelf: `package:${kind}` as const } : {}),
        ...(installed !== undefined ? { installed } : {}),
        ...(session.projectId ? { projectId: session.projectId } : {}),
        limit,
      })
      return page.listings.slice(0, limit)
    },
    detail: (ref) => service.detail(ref, actor),
    plan: (ref, scope) => service.plan(ref, scope, actor),
    install: (ref, scope, consent) => service.install(ref, scope, consent, actor),
    update: (ref, scope) => service.update(ref, scope, actor),
    remove: (ref, scope) => service.remove(ref, scope, actor),
    setEnabled: (ref, scope, enabled) => service.setEnabled(ref, scope, enabled, actor),
    async create(kind, scope, values) {
      // The create form holds the few fields a new item needs; the rest (an agent's
      // instructions) are saved as its settings, as the Store screen saves them after creating.
      const form = await service.createFields(kind, actor)
      const known = new Set(form.fields.map((field) => field.key))
      const entries = Object.entries(values)
      const ref = await service.create(
        kind,
        scope,
        Object.fromEntries(entries.filter(([key]) => known.has(key))),
        actor,
      )
      const rest = entries.filter(([key]) => !known.has(key))
      if (rest.length === 0) return ref
      try {
        await service.setConfig(ref, scope, Object.fromEntries(rest), actor)
      } catch (error) {
        // An agent left with the form's placeholder instructions is worse than none.
        await service.remove(ref, scope, actor).catch(() => {})
        throw error
      }
      return ref
    },
  }
}
