import { createBrowserTool } from './tools/browser/browser'
import { createAgentTool } from './tools/agent/agent-tool'
import { createSendMessageTool } from './tools/agent/send-message'
import { createTaskStopTool } from './tools/agent/task-stop'
import { createStoreTool } from './tools/store'
import { createLoopsTool } from './tools/loops'
import { createConfigureTool } from './tools/configure/configure'
import { createPlanTool } from './tools/plan/plan'
import { createWorkflowTool } from './tools/workflow/workflow'
import type { AgentTool } from '@localixai/agent/agents'
import type { RuntimeToolRegistryOptions } from './tool-registry'

// Conditionally-registered ("named optional") tools for createRuntimeToolRegistry:
// each is present only when its external dependency/options are provided. Extracted
// from tool-registry.ts so that file owns core-tool construction plus the shared
// profile/surface/disabledTools filtering and assembly. No filtering happens here.

export function buildNamedOptionals(options: RuntimeToolRegistryOptions): AgentTool[] {
  const namedOptionals: AgentTool[] = []
  const optional = options.optional ?? {}

  if (optional.Store) {
    namedOptionals.push(createStoreTool(optional.Store))
  }

  if (optional.Agent) namedOptionals.push(createAgentTool(optional.Agent))
  if (optional.SendMessage) namedOptionals.push(createSendMessageTool(optional.SendMessage))
  if (optional.TaskStop) namedOptionals.push(createTaskStopTool(optional.TaskStop))

  if (optional.Loops) {
    namedOptionals.push(createLoopsTool(optional.Loops))
  }

  if (optional.GlobalSearch) {
    namedOptionals.push(optional.GlobalSearch)
  }

  if (optional.ContextBudget) {
    namedOptionals.push(optional.ContextBudget)
  }

  if (optional.ToolOutput) {
    namedOptionals.push(optional.ToolOutput)
  }

  if (optional.Skill) {
    namedOptionals.push(optional.Skill)
  }

  if (optional.MiniAppGuide) {
    namedOptionals.push(optional.MiniAppGuide)
  }

  if (optional.Jobs) {
    namedOptionals.push(optional.Jobs)
  }

  if (optional.Vault) namedOptionals.push(optional.Vault)
  if (optional.ExternalAgentSessions) namedOptionals.push(optional.ExternalAgentSessions)

  if (optional.Browser) {
    namedOptionals.push(createBrowserTool(optional.Browser))
  }

  // Configuration proposals: inspect the ledger, raise a `config_change` HITL request. The
  // catalog marks it `never` for every unattended shape, so this branch only ever runs for a
  // chat — the port is simply not built elsewhere (`run/configure-options.ts`).
  if (optional.Configure) {
    namedOptionals.push(createConfigureTool(optional.Configure))
  }

  // The conversation's plan, in every mode: `complete` and `read` belong to the implementing
  // run after an approval. Each action checks the state it needs (`present` needs plan mode).
  if (optional.Plan) {
    namedOptionals.push(createPlanTool(optional.Plan))
  }

  // Plugin workflows: present once a workflow command activated it for the session.
  if (optional.Workflow) {
    namedOptionals.push(createWorkflowTool(optional.Workflow))
  }

  return namedOptionals
}
