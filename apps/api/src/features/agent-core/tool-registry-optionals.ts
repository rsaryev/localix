import { createBrowserTool } from './tools/browser/browser'
import { createDelegateTool } from './tools/delegate'
import { createAgentsTool } from './tools/agents'
import { createLoopsTool } from './tools/loops'
import { createPluginBuildTool } from './tools/plugin-build'
import { createSetTopicTool } from './tools/set-topic'
import { createConfigureTool } from './tools/configure/configure'
import { createPlanTool } from './tools/plan/plan'
import { createCodemodeTool } from './tools/codemode/codemode'
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

  if (optional.agents) {
    namedOptionals.push({ tool: createAgentsTool(optional.agents) })
  }

  if (optional.delegate) {
    namedOptionals.push({ tool: createDelegateTool(optional.delegate) })
  }

  if (optional.loops) {
    namedOptionals.push({
      tool: createLoopsTool(optional.loops),
    })
  }

  if (optional.plugin_build) {
    namedOptionals.push({
      tool: createPluginBuildTool(optional.plugin_build),
    })
  }

  if (optional.memory) {
    namedOptionals.push({
      tool: optional.memory,
    })
  }

  if (optional.global_search) {
    namedOptionals.push({
      tool: optional.global_search,
    })
  }

  if (optional.context_budget) {
    namedOptionals.push({
      tool: optional.context_budget,
    })
  }

  if (optional.tool_output) {
    namedOptionals.push({
      tool: optional.tool_output,
    })
  }

  if (optional.skill) {
    namedOptionals.push({
      tool: optional.skill,
    })
  }

  if (optional.jobs) {
    namedOptionals.push({
      tool: optional.jobs,
    })
  }

  if (optional.browser) {
    namedOptionals.push({
      tool: createBrowserTool(optional.browser),
    })
  }

  // A participant's pass, in a conversation that has colleagues to name it.
  if (optional.skip_answer) {
    namedOptionals.push({ tool: optional.skip_answer })
  }

  // A new session topic for the leader or sole participant of a chat.
  if (optional.set_topic) {
    namedOptionals.push({
      tool: createSetTopicTool(optional.set_topic),
    })
  }

  // Configuration proposals: inspect the ledger, raise a `config_change` HITL request. The
  // catalog marks it `never` for every unattended shape, so this branch only ever runs for a
  // chat — the port is simply not built elsewhere (`run/configure-options.ts`).
  if (optional.configure) {
    namedOptionals.push({
      tool: createConfigureTool(optional.configure),
    })
  }

  // The conversation's plan, in every mode: `complete` and `read` belong to the implementing
  // run after an approval. Each action checks the state it needs (`present` needs plan mode).
  if (optional.plan) {
    namedOptionals.push({
      tool: createPlanTool(optional.plan),
    })
  }

  // Scripts that call this run's tools. Rebuilt by the assembly from the live tools it declares.
  if (optional.codemode) {
    namedOptionals.push({ tool: createCodemodeTool(optional.codemode, []) })
  }

  return namedOptionals
}
