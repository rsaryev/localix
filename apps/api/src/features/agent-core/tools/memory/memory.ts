import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import { MemoryBudgetError, type MemoryRepository } from '../../../memory/repository'

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
 * Where a `set` lands. Global ('') is reached ONLY by an explicit scope:"global" — so a
 * project/task fact saved in a no-project session can't silently pollute every future session
 * (the bug: a 2048 build-log landed in global and surfaced on an unrelated "hi"). Default + every
 * other scope resolves to the NARROWEST available: project if in one, else this session; global
 * is the degenerate fallback only when there is neither (e.g. tests/headless). One owner, because
 * the classifier must name the same scope the write then uses.
 */
function setTargetScope(scope: unknown, projectScope: string, sessionScope: string): string {
  if (scope === 'global') return ''
  if (scope === 'session') return sessionScope || projectScope
  return projectScope || sessionScope
}

/**
 * What one memory call reaches. A note kept in THIS conversation's scope is deleted with it
 * (`session`); a project or global note outlives it (`host`), which a read-only session must not
 * write. A delete removes the key from every visible scope — global included — and cannot be
 * redone. An unknown action is answered with the widest effect.
 */
function classifyMemoryCall(input: unknown, projectScope: string, sessionScope: string): CallClass {
  const call = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  if (call.action === 'get' || call.action === 'list') return { effect: 'read' }
  if (call.action === 'set') {
    const target = setTargetScope(call.scope, projectScope, sessionScope)
    return { effect: target.startsWith('session:') ? 'session' : 'host' }
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
) {
  const projectScope = projectId ?? ''
  const sessionScope = sessionId ? `session:${sessionId}` : ''
  return defineAgentTool({
    name: TOOL.memory,
    label: 'Memory',
    activeVerb: 'Querying memory',
    description: [
      'Persist and recall short notes across sessions. set writes to the narrowest scope (the project, or this session outside one); scope="global" only for durable facts about the user under `user.*` keys. get/list read every visible scope, narrowest wins.',
      'Save declarative FACTS, not instructions, and nothing that goes stale within a week (task progress, PR numbers, SHAs) — past work is recalled via history_search.',
    ].join(' '),
    inputSchema: memoryToolInputSchema,
    executionMode: 'sequential',
    mutates: true,
    classify: (input) => classifyMemoryCall(input, projectScope, sessionScope),
    async execute(_toolCallId, input) {
      // Reads see session + project + global; narrower scopes win on key clash.
      const scopes = [...new Set([sessionScope, projectScope, ''])]
      const preferenceOrder = [sessionScope, projectScope, ''].filter((s, i) => s !== '' || i === 2)
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
          const targetScope = setTargetScope(input.scope, projectScope, sessionScope)
          try {
            await repo.set(userId, targetScope, input.key, input.value, new Date().toISOString())
          } catch (error) {
            if (error instanceof MemoryBudgetError) return { content: error.message, isError: true }
            throw error
          }
          return { content: `Memory saved: "${input.key}" (${scopeLabel(targetScope)})` }
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
