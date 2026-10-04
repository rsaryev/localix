import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
/** Compatibility lookup for delegate's remaining external plugin-agent path. */
import type { Kysely } from 'kysely'

import type { AppDatabase } from '../db/types'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { buildPluginCatalog } from '../features/plugins/catalog'
import { userHome } from '../lib/env'
import { readAvailability } from '../features/capabilities/availability'

/** An agent contributed by a plugin manifest, as the plugin catalog reports it. */
type PluginAgent = Awaited<
  ReturnType<typeof buildPluginCatalog>
>['enabled'][number]['plugin']['agents'][number]

/**
 * Split a sub-agent name into `<plugin>:<agent>`, or null when it is a BARE name
 * that belongs to the Managed-Agents registry instead.
 *
 * A leading `:` (index 0) is NOT a plugin separator — it would name an empty
 * plugin — so it falls through to the registry, exactly as both call sites did.
 */
export function parsePluginAgentRef(ref: string): { plugin: string; agent: string } | null {
  const sep = ref.indexOf(':')
  if (sep <= 0) return null
  return { plugin: ref.slice(0, sep), agent: ref.slice(sep + 1) }
}

/**
 * The agent an ENABLED plugin contributes under `<plugin>:<agent>` — or null when
 * no such plugin/agent is visible in `scope`.
 *
 * `scope` is the CALLER's, deliberately: a plugin is discovered under a `cwd` AND
 * enabled under a `projectId`, so BOTH halves are load-bearing and must describe
 * the same place. Pass a project's id with a null cwd and its plugins are never
 * scanned; pass its cwd with an empty id and the scanned plugins are tagged
 * `projectId: ''`, so their enable rows (keyed `<projectId>:<name>`) are never
 * found and a project plugin can only ever read as DISABLED.
 *
 * Never throws: a catalog failure resolves to null, so a bad plugin cannot break
 * a delegation.
 */
export async function findPluginAgent(
  deps: { db: Kysely<AppDatabase>; userId: string },
  ref: { plugin: string; agent: string },
  scope: { projectId?: string | null; cwd?: string | null },
): Promise<PluginAgent | null> {
  const catalog = await buildPluginCatalog({
    homeDir: userHome(),
    repo: createCapabilitySourceRepository(deps.db, 'plugin'),
    availability: await readAvailability(deps.db, {
      userId: deps.userId,
      agentId: DEFAULT_AGENT_ID,
    }),
    userId: deps.userId,
    projectId: scope.projectId ?? '',
    cwd: scope.cwd ?? null,
  }).catch(() => null)
  const entry = catalog?.enabled.find((e) => e.plugin.manifest.name === ref.plugin)
  return entry?.plugin.agents.find((a) => a.name === ref.agent) ?? null
}

/** The role fields a delegate child runs under, whatever kind of agent it came from. */
interface DelegateRoleFields {
  prompt: string
  tools?: readonly string[]
  disallowedTools?: readonly string[]
  pinnedSkills?: readonly string[]
  preferredModel?: string
  /** CC `effort:` — the reasoning effort the agent declares; validated before use. */
  preferredEffort?: string
  maxTurns?: number
  memory?: 'user' | 'project' | 'local'
  color?: string
  isolation?: 'isolated'
  background?: boolean
  hooks?: unknown
}

/**
 * An agent — registry record OR plugin-contributed — as the role `delegate` runs it:
 * its own external fields until this compatibility path is replaced by native registration.
 *
 * Both branches of delegate's resolver used to spell this field list out separately,
 * so a new role field could reach the registry branch and silently miss the plugin
 * one. One spelling now, and the two agent shapes meet at the structural constraint.
 */
export function toDelegateRole<T extends DelegateRoleFields>(rec: T): DelegateRoleFields {
  return {
    prompt: rec.prompt,
    tools: rec.tools,
    disallowedTools: rec.disallowedTools,
    pinnedSkills: rec.pinnedSkills,
    preferredModel: rec.preferredModel,
    preferredEffort: rec.preferredEffort,
    maxTurns: rec.maxTurns,
    memory: rec.memory,
    color: rec.color,
    isolation: rec.isolation,
    background: rec.background,
    hooks: rec.hooks,
  }
}
