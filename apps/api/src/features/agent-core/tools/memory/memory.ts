import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import type { MemoryRepository } from '../../../memory/repository'
import { memoryScopePolicy, type MemoryScope } from '../../memory-scope-policy'

const memoryToolInputSchema = z.object({
  action: z.enum(['get', 'set', 'list', 'delete']),
  key: z.string().optional().describe('Short slug, e.g. "user_role". Required except for list.'),
  value: z.string().optional().describe('set: the note, kept short.'),
  // Where each scope lives, and when "global" is right, is the description's; not restated.
  scope: z.enum(['session', 'project', 'global']).optional(),
})

function scopeLabel(projectId: string): 'session' | 'project' | 'global' {
  if (!projectId) return 'global'
  return projectId.startsWith('session:') ? 'session' : 'project'
}

/**
 * The store's refusal of a write past its budget (`memory/repository.ts`). Recognised by name so
 * the tool depends on the memory store's type only, never on its module.
 */
const isMemoryBudgetError = (error: unknown): error is Error =>
  error instanceof Error && error.name === 'MemoryBudgetError'

/**
 * What one memory call reaches. A note kept in THIS conversation's scope is deleted with it
 * (`session`); a project or global note outlives it (`host`), which a read-only session must not
 * write. A delete removes the key from every visible scope — global included — and cannot be
 * redone. An unknown action is answered with the widest effect.
 */
function classifyMemoryCall(
  input: unknown,
  policy: ReturnType<typeof memoryScopePolicy>,
): CallClass {
  const call = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  if (call.action === 'get' || call.action === 'list') return { effect: 'read' }
  if (call.action === 'set') {
    try {
      const target = policy.target(call.scope as MemoryScope | undefined)
      return { effect: target.startsWith('session:') ? 'session' : 'host' }
    } catch {
      return { effect: 'host' }
    }
  }
  if (call.action === 'delete') return { effect: 'host', irreversible: true }
  return { effect: 'external' }
}

/**
 * @param repo Memory data-access layer (scope-aware CRUD over agent_memory).
 * @param projectId The active project id, or null for a non-project session.
 * @param sessionId The session (root) id — enables a per-conversation "session" scope so
 *   ephemeral facts (e.g. a path the user just gave) never bleed into other sessions.
 *   Memory is isolated per project/session; global memories ('' scope) are visible everywhere.
 */
export function createMemoryTool(
  repo: MemoryRepository,
  userId: string,
  projectId?: string | null,
  sessionId?: string,
  selection?: MemoryScope,
) {
  const policy = memoryScopePolicy(projectId, sessionId, selection)
  return defineAgentTool({
    name: TOOL.memory,
    label: 'Memory',
    activeVerb: 'Querying memory',
    description: [
      selection
        ? `Recall and persist short notes only in the agent's ${selection} scope. Other scopes are unavailable.`
        : 'Persist and recall short notes across sessions. set writes to the narrowest scope (the project, or this session outside one); scope="global" only for durable facts about the user under `user.*` keys. get/list read every visible scope, narrowest wins.',
      'Save declarative FACTS, not instructions, and nothing that goes stale within a week (task progress, PR numbers, SHAs) — past work is recalled via global_search.',
    ].join(' '),
    inputSchema: memoryToolInputSchema,
    executionMode: 'sequential',
    // get/list only read, so they overlap other reads; set/delete stay a barrier in their turn.
    executionModeFor: (input) =>
      classifyMemoryCall(input, policy).effect === 'read' ? 'parallel' : 'sequential',
    mutates: true,
    classify: (input) => classifyMemoryCall(input, policy),
    async execute(_toolCallId, input) {
      // Read and write scope selection share the same policy; narrower visible notes win.
      const scopes = policy.scopes
      const preferenceOrder = scopes
      if (input.scope && selection && input.scope !== selection) {
        return { content: `This agent's memory scope is ${selection}.`, isError: true }
      }
      switch (input.action) {
        case 'get': {
          if (!input.key) return { content: 'key is required for action="get".', isError: true }
          const rows = await repo.getByKey(userId, input.key, scopes)
          if (rows.length === 0) return { content: `No memory found for key "${input.key}"` }
          // Prefer the narrowest scope (session > project > global) on a key clash.
          const preferred =
            preferenceOrder.map((s) => rows.find((r) => r.projectId === s)).find(Boolean) ?? rows[0]
          return { content: preferred.value }
        }

        case 'set': {
          if (!input.key) return { content: 'key is required for action="set".', isError: true }
          if (input.value === undefined)
            return { content: 'value is required for action="set".', isError: true }
          try {
            const targetScope = policy.target(input.scope)
            await repo.set(userId, targetScope, input.key, input.value, new Date().toISOString())
            return { content: `Memory saved: "${input.key}" (${scopeLabel(targetScope)})` }
          } catch (error) {
            if (isMemoryBudgetError(error)) return { content: error.message, isError: true }
            if (error instanceof Error && error.message.startsWith('Memory scope ')) {
              return { content: error.message, isError: true }
            }
            throw error
          }
        }

        case 'list': {
          const rows = await repo.list(userId, scopes, 'key')
          if (rows.length === 0) return { content: 'No memories stored.' }
          const tagged = rows.map((r) => ({
            key: r.key,
            value: r.value,
            scope: scopeLabel(r.projectId),
          }))
          return { content: JSON.stringify(tagged, null, 2) }
        }

        case 'delete': {
          if (!input.key) return { content: 'key is required for action="delete".', isError: true }
          const deleted = await repo.deleteByKey(userId, input.key, scopes)
          return {
            content: deleted
              ? `Memory deleted: "${input.key}"`
              : `No memory found for key "${input.key}"`,
          }
        }
      }
    },
  })
}
