import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentMcpServerSpec, HooksSettings } from '@rsaryev/llx-plugin'
import {
  agentHookGroups,
  hooksTrustGate,
  MODEL_ALIASES,
  planAgentMemory,
  planPreloadedSkills,
  resolveAgentMcpServers,
  resolveSubagentModel,
  resolveSubagentPermissionMode,
  type MemoryPlan,
} from '@rsaryev/llx-plugin/agents'
import type { AgentSource } from '@rsaryev/llx-plugin/format'
import type { AgentPermissionMode } from '../../../contracts/agent-permission-mode'
import { bestModelForFamily, type ModelAliasFamily } from '../../agent-core/model-alias'
import type { PermissionMode } from '../../../contracts/permission-modes'

/**
 * What a subagent starts with, as Claude Code defines it (sub-agents.md): the kit plans, Localix
 * runs the child. Each function here is the kit's rule seen through Localix's own records.
 */

/** A skill as the preload plan needs it: found by the name an agent file writes. */
export interface PreloadableSkill {
  disableModelInvocation?: boolean
}

/**
 * The skills an agent file's `skills` preloads: the first 32 distinct names, a missing or
 * `disable-model-invocation` one skipped in its place (sub-agents.md, "Preload skills into
 * subagents").
 */
export function preloadedSkillNames(
  names: readonly string[],
  skillOf: (name: string) => PreloadableSkill | undefined,
): readonly string[] {
  return planPreloadedSkills(names, {
    has: (name) => skillOf(name) !== undefined,
    isModelInvocable: (name) => skillOf(name)?.disableModelInvocation !== true,
  }).load
}

export type AgentMemoryScope = 'user' | 'project' | 'local'
export type AgentMemory = MemoryPlan

export interface AgentMemoryContext {
  projectDir: string
  homeDir: string
  /** Claude Code's configuration folder, `CLAUDE_CONFIG_DIR` resolved: the user scope lives below it. */
  configDir: string
  /** Auto memory is on; asked only for an agent with a `memory` scope. */
  autoMemoryEnabled: () => boolean
}

/**
 * An agent file's `memory` (sub-agents.md, "Enable persistent memory"): its folder, the part of its
 * `MEMORY.md` the prompt includes and the tools that keep it; undefined with no scope or with auto
 * memory off. The folder is named by the agent type, a plugin's `:` written as `-`.
 */
export async function agentMemory(
  scope: AgentMemoryScope | undefined,
  agentType: string,
  context: AgentMemoryContext,
): Promise<AgentMemory | undefined> {
  if (scope === undefined) return undefined
  return planAgentMemory(scope, agentType, {
    autoMemoryEnabled: context.autoMemoryEnabled(),
    configDir: context.configDir,
    locations: {
      homeDir: () => context.homeDir,
      projectDir: () => context.projectDir,
      joinPath: join,
    },
    files: { readText: (path) => readFile(path, 'utf8').catch(() => undefined) },
  })
}

const AGENT_SOURCES: ReadonlySet<string> = new Set<AgentSource>([
  'managed',
  'flag',
  'project',
  'user',
  'plugin',
])

const agentSourceOf = (source: string | undefined): AgentSource | undefined =>
  source !== undefined && AGENT_SOURCES.has(source) ? (source as AgentSource) : undefined

/** An agent's `mcpServers` as the kit resolves them; inline definitions kept as written. */
export interface AgentMcpSpecs {
  references: readonly string[]
  inline: Readonly<Record<string, unknown>>
  /** Inline servers that wait for the folder's trust. */
  skipped: readonly string[]
}

/**
 * The MCP servers an agent's `mcpServers` gives a subagent (sub-agents.md, "Scope MCP servers to a
 * subagent"): none for a plugin's agent or a built-in type, and a project file's inline servers
 * only once its folder is trusted. The organisation's allow and deny lists are applied where the
 * run gathers its servers, as for every other server.
 */
export function agentMcpSpecs(
  specs: readonly unknown[] | undefined,
  agent: { source?: string; folderTrusted: boolean },
): AgentMcpSpecs {
  const source = agentSourceOf(agent.source)
  if (!source) return { references: [], inline: {}, skipped: [] }
  const allowAll = { allows: () => true, managedAllows: () => true }
  const resolved = resolveAgentMcpServers(specs as readonly AgentMcpServerSpec[] | undefined, {
    source,
    folderTrusted: agent.folderTrusted,
    policy: allowAll,
  })
  return {
    references: resolved.references,
    inline: resolved.inline,
    skipped: resolved.skipped.map((entry) => entry.name),
  }
}

/**
 * Whether a delegated agent's frontmatter `hooks` run (sub-agents.md, "Hooks in subagent
 * frontmatter"): not a plugin's, and a project's only once its folder is trusted. A built-in type
 * has no file, so no hooks.
 */
export function agentHooksRun(
  agent: { source?: string; hooks?: unknown },
  folderTrusted: boolean,
): boolean {
  const own = agentSourceOf(agent.source)
  const { hooks } = agent
  if (!own || hooks === undefined) return false
  const groups = agentHookGroups({ source: own, hooks: hooks as HooksSettings }, 'subagent')
  return Object.keys(groups).length > 0 && hooksTrustGate(own, folderTrusted) === 'run'
}

/** Localix's modes as Claude Code's: Bypass and Autonomous both skip every prompt. */
const CC_MODE = {
  default: 'default',
  plan: 'plan',
  bypass: 'bypassPermissions',
  autonomous: 'bypassPermissions',
} as const satisfies Record<PermissionMode, string>

const LOCALIX_MODES: ReadonlySet<string> = new Set<AgentPermissionMode>(['default', 'plan'])

/**
 * The mode an agent file's `permissionMode` asks for, among those Localix has (`default`, `manual`
 * read as it, and `plan`): what the kit lets apply under a Default conversation. `acceptEdits`,
 * `auto`, `dontAsk` and `bypassPermissions` have no Localix mode that behaves as they do.
 */
export function askedPermissionMode(written: string | undefined): AgentPermissionMode | undefined {
  const { mode, basis } = resolveSubagentPermissionMode({
    main: 'default',
    set: written,
    autoAvailable: false,
  })
  return basis === 'set' && LOCALIX_MODES.has(mode) ? (mode as AgentPermissionMode) : undefined
}

/**
 * The mode a delegated child runs in (sub-agents.md, "Permission modes"): the conversation's, unless
 * the kit lets the agent's own apply, which only a Default conversation does.
 */
export function subagentPermissionMode(
  conversation: PermissionMode,
  asked: AgentPermissionMode | undefined,
): PermissionMode {
  const { mode, basis } = resolveSubagentPermissionMode({
    main: CC_MODE[conversation],
    set: asked,
    autoAvailable: false,
  })
  return basis === 'set' && LOCALIX_MODES.has(mode) ? (mode as AgentPermissionMode) : conversation
}

/** The main model's alias family, by the alias its id names (`claude-sonnet-4-5` is `sonnet`). */
const familyOf = (modelId: string): string | undefined =>
  MODEL_ALIASES.find((alias) => modelId.toLowerCase().includes(alias))

/** Where the chat runs: its model, and the model ids its providers offer. */
export interface SubagentModelContext {
  mainModel: string
  available: readonly string[]
}

/**
 * The route an agent file's `model` gives a child the person chose no model for (sub-agents.md,
 * "Choose a model"), as the kit resolves it (`resolveSubagentModel`) and Localix's providers carry
 * it: the main model (`inherit`, or an alias of its family) is no route, so the child keeps its
 * session's; another alias is the newest model of that family the providers offer; a full id is
 * that model when they offer it. Anything they do not offer leaves the session's model.
 */
export function subagentModelRoute(
  definition: string | undefined,
  context: SubagentModelContext,
): { modelId?: string; providerConnectionId?: null } {
  const family = familyOf(context.mainModel)
  const { model, kind } = resolveSubagentModel({
    definition,
    mainModel: context.mainModel,
    ...(family ? { mainFamily: family } : {}),
  })
  const routed =
    kind === 'alias'
      ? bestModelForFamily(model as ModelAliasFamily, context.available)
      : kind === 'full-id' && context.available.includes(model)
        ? model
        : undefined
  return routed ? { modelId: routed, providerConnectionId: null } : {}
}
