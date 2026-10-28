import { createBrowserTool } from './tools/browser/browser'
import { createAgentTool } from './tools/agent/agent-tool'
import { createSendMessageTool } from './tools/agent/send-message'
import { createTaskStopTool } from './tools/agent/task-stop'
import { createStoreTool } from './tools/store'
import { createLoopsTool } from './tools/loops'
import { createConfigureTool } from './tools/configure/configure'
import { createPlanTool } from './tools/plan/plan'
import { createWorkflowTool } from './tools/workflow/workflow'
import type { RuntimeToolRegistryOptions } from './tool-registry'
import type { RegistryContext, RegistryEntry } from './tool-registry-core'

// Conditionally-registered ("named optional") tools for createRuntimeToolRegistry:
// each is present only when its external dependency/options are provided. Extracted
// from tool-registry.ts so that file owns core-tool construction plus the shared
// profile/surface/disabledTools filtering and assembly. Each entry carries
// only the authoritative AgentTool descriptor; no filtering happens here.

// `ctx` is taken (not re-derived from `options`) so the profile default is resolved exactly
// once, in buildRegistryContext — a second `options.agentProfile ?? orchestrator` fallback here
// would be a second chance to get "which profile is this" wrong.
export function buildNamedOptionals(
  options: RuntimeToolRegistryOptions,
  _ctx: RegistryContext,
): RegistryEntry[] {
  const namedOptionals: RegistryEntry[] = []
  const optional = options.optional ?? {}

  if (optional.Store) {
    namedOptionals.push({ tool: createStoreTool(optional.Store) })
  }

  if (optional.Agent) namedOptionals.push({ tool: createAgentTool(optional.Agent) })
  if (optional.SendMessage)
    namedOptionals.push({ tool: createSendMessageTool(optional.SendMessage) })
  if (optional.TaskStop) namedOptionals.push({ tool: createTaskStopTool(optional.TaskStop) })

  if (optional.Loops) {
    namedOptionals.push({
      tool: createLoopsTool(optional.Loops),
    })
  }

  if (optional.GlobalSearch) {
    namedOptionals.push({
      tool: optional.GlobalSearch,
    })
  }

  if (optional.ContextBudget) {
    namedOptionals.push({
      tool: optional.ContextBudget,
    })
  }

  if (optional.ToolOutput) {
    namedOptionals.push({
      tool: optional.ToolOutput,
    })
  }

  if (optional.Skill) {
    namedOptionals.push({
      tool: optional.Skill,
    })
  }

  if (optional.MiniAppGuide) {
    namedOptionals.push({
      tool: optional.MiniAppGuide,
    })
  }

  if (optional.Jobs) {
    namedOptionals.push({
      tool: optional.Jobs,
    })
  }

  if (optional.Vault) namedOptionals.push({ tool: optional.Vault })
  if (optional.ExternalAgentSessions) namedOptionals.push({ tool: optional.ExternalAgentSessions })

  if (optional.Browser) {
    namedOptionals.push({
      tool: createBrowserTool(optional.Browser),
    })
  }

  // Configuration proposals: inspect the ledger, raise a `config_change` HITL request. The
  // catalog marks it `never` for every unattended shape, so this branch only ever runs for a
  // chat — the port is simply not built elsewhere (`run/configure-options.ts`).
  if (optional.Configure) {
    namedOptionals.push({
      tool: createConfigureTool(optional.Configure),
    })
  }

  // The conversation's plan, in every mode: `complete` and `read` belong to the implementing
  // run after an approval. Each action checks the state it needs (`present` needs plan mode).
  if (optional.Plan) {
    namedOptionals.push({
      tool: createPlanTool(optional.Plan),
    })
  }

  // Plugin workflows: present once a workflow command activated it for the session.
  if (optional.Workflow) {
    namedOptionals.push({ tool: createWorkflowTool(optional.Workflow) })
  }

  return namedOptionals
}
