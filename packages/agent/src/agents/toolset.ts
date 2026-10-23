import type { AgentTool, ToolSurface } from './types'

/**
 * Evaluate a tool descriptor against the current runtime surface. This is the
 * single policy predicate used before model and dispatch projection.
 */
export function isAgentToolAvailable(tool: AgentTool, surface?: ToolSurface): boolean {
  const required = tool.availability?.requiredCapabilities
  if (!required || required.length === 0) return true
  if (!surface) return false
  const available = new Set(surface.capabilities)
  return required.every((capability) => available.has(capability))
}

export interface AgentToolSet {
  readonly tools: readonly AgentTool[]
}

export type AgentToolSource =
  | AgentTool
  | AgentToolSet
  | readonly AgentToolSource[]
  | null
  | undefined

export function defineAgentTool<TInput = unknown, TDetails = unknown>(
  tool: AgentTool<TInput, TDetails>,
): AgentTool<TInput, TDetails> {
  return tool
}

export function createToolSet(tools: readonly AgentToolSource[]): AgentToolSet {
  return {
    tools: flattenToolSources(tools),
  }
}

export function mergeToolSets(...sets: readonly AgentToolSource[]): AgentToolSet {
  return createToolSet(sets)
}

export function getAgentTools(source: AgentToolSource): AgentTool[] {
  return flattenToolSources([source])
}

/**
 * Enforce the provider/runtime tool-registry invariants at the execution boundary.
 *
 * `modelTools` may be a strict subset of `dispatchTools` when a runtime adapter
 * owns the model schema channel (for example deferred tool activation), but names
 * must be unique in both projections and
 * every model-visible schema must have a runtime implementation. Silent `Map`
 * last-wins behavior can otherwise send one schema while dispatching a different
 * implementation.
 */
export function validateToolRegistry(
  modelTools: readonly AgentTool[],
  dispatchTools: readonly AgentTool[] = modelTools,
): void {
  const duplicateNames = (tools: readonly AgentTool[]): string[] => {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const tool of tools) {
      if (seen.has(tool.name)) duplicates.add(tool.name)
      else seen.add(tool.name)
    }
    return [...duplicates].sort()
  }

  const duplicateModelNames = duplicateNames(modelTools)
  if (duplicateModelNames.length > 0) {
    throw new Error(`Duplicate model tool names: ${duplicateModelNames.join(', ')}`)
  }

  const duplicateDispatchNames = duplicateNames(dispatchTools)
  if (duplicateDispatchNames.length > 0) {
    throw new Error(`Duplicate dispatch tool names: ${duplicateDispatchNames.join(', ')}`)
  }

  // A model name is a second key for the same tool: a provider must accept it, and no other tool
  // may answer to it, or a call made under it could not be routed back.
  const owners = new Map(dispatchTools.map((tool) => [tool.name, tool.name]))
  for (const { name, modelName } of dispatchTools) {
    if (modelName === undefined || modelName === name) continue
    if (!MODEL_TOOL_NAME.test(modelName))
      throw new Error(`Invalid model name for tool ${name}: ${modelName}`)
    const owner = owners.get(modelName)
    if (owner !== undefined)
      throw new Error(`Model tool name ${modelName} is taken by ${owner}; ${name} cannot use it`)
    owners.set(modelName, name)
  }

  const dispatchNames = new Set(dispatchTools.map((tool) => tool.name))
  const missingDispatchNames: string[] = []
  for (const tool of modelTools) {
    if (!dispatchNames.has(tool.name)) missingDispatchNames.push(tool.name)
  }
  missingDispatchNames.sort()
  if (missingDispatchNames.length > 0) {
    throw new Error(
      `Model tools missing runtime dispatch implementations: ${missingDispatchNames.join(', ')}`,
    )
  }
}

/** What every provider accepts as a tool name ({@link AgentTool.modelName}). */
const MODEL_TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/

function flattenToolSources(sources: readonly AgentToolSource[]): AgentTool[] {
  const tools = new Map<string, AgentTool>()

  const visit = (source: AgentToolSource) => {
    if (!source) return
    if (isToolSourceArray(source)) {
      source.forEach(visit)
      return
    }
    if (isToolSet(source)) {
      source.tools.forEach(visit)
      return
    }
    if (tools.has(source.name)) {
      console.warn(
        `[localixai/agent] Tool "${source.name}" is registered more than once; the last registration wins. Check your tool list for duplicates.`,
      )
    }
    tools.set(source.name, source)
  }

  sources.forEach(visit)
  return [...tools.values()]
}

function isToolSet(source: AgentTool | AgentToolSet): source is AgentToolSet {
  return Array.isArray((source as AgentToolSet).tools)
}

function isToolSourceArray(source: AgentToolSource): source is readonly AgentToolSource[] {
  return Array.isArray(source)
}
