/**
 * WHAT THE MODEL SEES of a run's tools, and how that changes mid-run.
 *
 * Every dispatch tool stays executable; the model is shown only the tools the host put on the
 * wire. A tool that `activatesTools` names more of them in its result's `details.activated`, and
 * those join the roster from the next model request on. Schemas are compacted for the model once
 * per tool — the full schema stays with dispatch, where calls are validated.
 */
import { prepareModelToolSchema } from '@localixai/agent'
import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'
import type { ModelToolDeclaration } from '@localixai/agent/runtime'

import type { RunTool } from './call'

export interface ToolRoster {
  /** The declarations for the next model request, in the order tools joined. */
  declarations(): ModelToolDeclaration[]
  /** Read an activator's result and reveal what it activated. Returns the names revealed. */
  reveal(tool: AgentTool | undefined, result: AgentToolResult): string[]
}

export function createToolRoster(
  modelTools: readonly AgentTool[],
  dispatch: ReadonlyMap<string, RunTool>,
  onCompacted?: (toolName: string, diagnostic: unknown) => void,
): ToolRoster {
  const declared = new Map<string, ModelToolDeclaration>()
  let snapshot: ModelToolDeclaration[] | undefined

  const addDeclaration = (tool: AgentTool) => {
    const full = dispatch.get(tool.name)?.jsonSchema ?? {}
    const prepared = prepareModelToolSchema(full as Record<string, unknown>)
    if (prepared.diagnostic) onCompacted?.(tool.name, prepared.diagnostic)
    declared.set(tool.name, {
      name: tool.name,
      description: tool.description,
      inputSchema: prepared.schema,
    })
    snapshot = undefined
  }
  for (const tool of modelTools) addDeclaration(tool)

  return {
    // The same array until the roster changes: a request repeats the exact tool payload, which
    // is what keeps a provider's prompt cache warm across turns.
    declarations: () => (snapshot ??= [...declared.values()]),
    reveal(tool, result) {
      if (!tool?.activatesTools || result.isError) return []
      const activated = (result.details as { activated?: unknown } | undefined)?.activated
      if (!Array.isArray(activated)) return []
      const revealed: string[] = []
      for (const name of activated) {
        if (typeof name !== 'string' || declared.has(name)) continue
        const runTool = dispatch.get(name)
        if (!runTool) continue
        addDeclaration(runTool.tool)
        revealed.push(name)
      }
      return revealed
    },
  }
}
