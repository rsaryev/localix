/**
 * CAPABILITY CLEANUP — a reactor on the core change feed.
 *
 * A plugin or an MCP server is addressed by name everywhere but its own row: every agent's
 * switches (`plugin:<name>`, `mcp:<name>`, and an MCP server's per-tool `mcp:<name>/<tool>`), the
 * MCP sign-in tokens, the vault bindings a plugin recorded and the vault items holding its
 * sensitive options. Its removal left all of them, so a same-named newcomer inherited an old
 * `allow` and the vault kept reporting a consumer that was gone. On a deletion notice whose name
 * is installed in no scope any more, they go.
 *
 * Only the switch rows go: a rule the person wrote about particular arguments stays theirs, inert
 * (as `AvailabilityWriter.clear` does). There is no reconcile: what a removed capability left is
 * only found from its notice — a sweep of names without a row would also take plugin-provided MCP
 * servers, which have none. A notice given up on leaves inert rows, as before this reactor.
 */
import type { Kysely } from 'kysely'
import type { ConsumerHandlers } from '@localixai/change-feed'

import type { AppDatabase } from '../../db'
import type { CoreCascades, CoreRefs } from '../changes/core-entities'
import { ACTION_PREFIX } from './resolve'
import { createCapabilityRuleRepository } from './rule-repository'

export interface CapabilityCleanupPorts {
  db: Kysely<AppDatabase>
  userId: string
  clearMcpSignIn(userId: string, serverId: string): Promise<void>
  unbindVaultConsumer(userId: string, type: string, id: string): Promise<number>
  /** Delete the vault items a plugin's sensitive options were stored in (absent: none are). */
  forgetPluginSecrets?(userId: string, name: string): Promise<void>
}

export function createCapabilityCleanup(ports: CapabilityCleanupPorts) {
  const { db, userId } = ports
  const rules = createCapabilityRuleRepository(db)

  const installed = async (kind: 'plugin' | 'mcp', name: string) =>
    Boolean(
      await db
        .selectFrom('capability_source')
        .select('id')
        .where('user_id', '=', userId)
        .where('kind', '=', kind)
        .where('name', '=', name)
        .executeTakeFirst(),
    )

  /** Drop the name's switches from every agent's list (each write bumps the revision). */
  async function clearSwitches(kind: 'plugin' | 'mcp', name: string): Promise<void> {
    const action = `${ACTION_PREFIX[kind]}${name}`
    const named = (rule: { action: string; resource: string }) =>
      rule.resource === '*' &&
      (rule.action === action || (kind === 'mcp' && rule.action.startsWith(`${action}/`)))
    const holders = await db
      .selectFrom('capability_rule')
      .select('agent_id')
      .distinct()
      .where('user_id', '=', userId)
      .where('resource', '=', '*')
      .where((eb) => eb.or([eb('action', '=', action), eb('action', 'like', `${action}/%`)]))
      .execute()
    for (const { agent_id } of holders)
      await rules.mutate(userId, agent_id, (current) => current.filter((rule) => !named(rule)))
  }

  async function removed(kind: 'plugin' | 'mcp', name: string, serverId?: string): Promise<void> {
    if (await installed(kind, name)) return
    await clearSwitches(kind, name)
    if (kind === 'mcp' && serverId) await ports.clearMcpSignIn(userId, serverId)
    if (kind === 'plugin') {
      await ports.forgetPluginSecrets?.(userId, name)
      await ports.unbindVaultConsumer(userId, 'plugin', name)
    }
  }

  const handlers: ConsumerHandlers<CoreRefs, CoreCascades> = {
    'chat.session': 'ignore',
    'chat.message': 'ignore',
    skill: 'ignore',
    plugin: (change) => (change.op === 'deleted' ? removed('plugin', change.ref.id) : undefined),
    mcp: (change) =>
      change.op === 'deleted' ? removed('mcp', change.ref.id, change.ref.serverId) : undefined,
    agent: 'ignore',
    project: 'ignore',
    'capability.rule': 'ignore',
    'local.model': 'ignore',
    'project.settings': 'ignore',
    'user.profile': 'ignore',
    'user.agent-settings': 'ignore',
    'user.view-state': 'ignore',
    secret: 'ignore',
    'system.toggle': 'ignore',
    'provider.connection': 'ignore',
  }
  return { handlers, removed }
}
