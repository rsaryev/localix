import { cp, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  agentHookGroups,
  catalogTier,
  hooksTrustGate,
  modelFamily,
  planAgentMemory,
  resolveAgentMcpServers,
  resolveSubagentModel,
  resolveSubagentPermissionMode,
  type CatalogAgent,
  type CatalogSource,
  type MemoryPlan,
  type ModelAlias,
} from '@rsaryev/llx-plugin/agents'
import type { AgentMemoryScope, AgentSource } from '@rsaryev/llx-plugin/format'
import { bestModelForFamily } from './model-alias'
import type { AgentPermissionMode } from '../../../contracts/agent-permission-mode'
import type { PermissionMode } from '../../../contracts/permission-modes'

/**
 * What a subagent starts with, as Claude Code defines it (sub-agents.md): the kit plans, Localix
 * runs the child. Each function here is the kit's rule seen through Localix's own records.
 */

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
): Promise<MemoryPlan | undefined> {
  if (scope === undefined) return undefined
  const plan = () =>
    planAgentMemory(scope, agentType, {
      autoMemoryEnabled: context.autoMemoryEnabled(),
      configDir: context.configDir,
      locations: {
        homeDir: () => context.homeDir,
        projectDir: () => context.projectDir,
        joinPath: join,
      },
      files: { readText: (path) => readFile(path, 'utf8').catch(() => undefined) },
    })
  const planned = await plan()
  if (!planned || !(await adoptedEarlierMemory(planned.directory, agentType))) return planned
  return plan()
}

const isDirectory = (path: string) =>
  stat(path).then(
    (found) => found.isDirectory(),
    () => false,
  )

/**
 * Localix used to name a plugin agent's memory folder by the agent's own name (`reviewer` for
 * `kit:reviewer`); the kit names it by the full type (`kit-reviewer`). The first time the new
 * folder is missing and the old one is there, the old one is copied in, and the old one is left as
 * it was: an agent of the same name from another plugin or the person's own may share it.
 */
async function adoptedEarlierMemory(directory: string, agentType: string): Promise<boolean> {
  const leaf = agentType.split(':').pop() ?? ''
  // A leaf that is a path (`..`, `a/b`) would name a folder outside the memory folder.
  const plainLeaf = /^[^/\\]+$/.test(leaf) && !/^\.+$/.test(leaf)
  if (!agentType.includes(':') || !plainLeaf || (await isDirectory(directory))) return false
  const earlier = join(dirname(directory), leaf)
  if (earlier === directory || !(await isDirectory(earlier))) return false
  await cp(earlier, directory, { recursive: true, errorOnExist: false, force: false })
  return true
}

/** The row of the priority table a catalog agent ranks by; none for a built-in type, which has no file. */
const fileSourceOf = (source: CatalogSource): AgentSource | undefined => {
  const tier = catalogTier(source)
  return tier === 'builtin' ? undefined : tier
}

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
  agent: Pick<CatalogAgent, 'source' | 'definition'>,
  folderTrusted: boolean,
): AgentMcpSpecs {
  const source = fileSourceOf(agent.source)
  if (!source) return { references: [], inline: {}, skipped: [] }
  const allowAll = { allows: () => true, managedAllows: () => true }
  const resolved = resolveAgentMcpServers(agent.definition.mcpServers, {
    source,
    folderTrusted,
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
  agent: Pick<CatalogAgent, 'source' | 'hooks'>,
  folderTrusted: boolean,
): boolean {
  const own = fileSourceOf(agent.source)
  const { hooks } = agent
  if (!own || hooks === undefined) return false
  const groups = agentHookGroups({ source: own, hooks }, 'subagent')
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

/** Where the chat runs: its model, and the model ids its providers offer. */
export interface SubagentModelContext {
  mainModel: string
  available: readonly string[]
}

/** What names a child's model: its agent file's `model` and the `Agent` call's `model` alias. */
export interface SubagentModelAsk {
  definition?: string
  invocation?: string
}

/** The environment's say (sub-agents.md, "Choose a model"): `CLAUDE_CODE_SUBAGENT_MODEL`, and `_FORCE`. */
type ModelEnv = Readonly<Record<string, string | undefined>>

/**
 * The route a child the person chose no model for takes (sub-agents.md, "Choose a model"): the
 * `Agent` call's alias, its agent file's `model`, then `CLAUDE_CODE_SUBAGENT_MODEL` (alone under
 * `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`), as the kit resolves them (`resolveSubagentModel`) and
 * Localix's providers carry them: the main model (`inherit`, or an alias of its family) is no route, so the child keeps its
 * session's; another alias is the newest model of that family the providers offer; a full id is
 * that model when they offer it. Anything they do not offer leaves the session's model.
 */
export function subagentModelRoute(
  ask: SubagentModelAsk,
  context: SubagentModelContext,
  env: ModelEnv = process.env,
): { modelId?: string; providerConnectionId?: null } {
  const family = modelFamily(context.mainModel)
  const { model, kind } = resolveSubagentModel({
    definition: ask.definition,
    invocation: ask.invocation,
    envModel: env.CLAUDE_CODE_SUBAGENT_MODEL,
    force: env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE === '1',
    mainModel: context.mainModel,
    ...(family ? { mainFamily: family } : {}),
  })
  const routed =
    kind === 'alias'
      ? bestModelForFamily(model as ModelAlias, context.available)
      : kind === 'full-id' && context.available.includes(model)
        ? model
        : undefined
  return routed ? { modelId: routed, providerConnectionId: null } : {}
}
