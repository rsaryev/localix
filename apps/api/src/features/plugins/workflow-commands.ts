import type { AvailabilityReader } from '../capabilities/availability'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { TOOL } from '../agent-core/tool-names'
import type { WorkflowEntry } from '../agent-core/tools/workflow/workflow'
import { buildPluginCatalog } from './catalog'
import type { PluginCommand } from './contracts'
import type { DiscoveredPlugin } from './discovery-types'
import type { PluginWorkflow } from './discovery-cc-components'

/**
 * A plugin's workflows as its commands: `/<plugin>:<name>`, as Claude Code names them. The command
 * asks the agent to run the workflow with the `workflow` tool and activates that tool for the
 * chat; the person's input becomes the workflow's `args`.
 */

export function workflowCommand(pluginName: string, workflow: PluginWorkflow): PluginCommand {
  const fullName = `${pluginName}:${workflow.name}`
  return {
    name: workflow.name,
    description: workflow.description,
    args: [],
    argumentHint: '[input]',
    activateTools: [TOOL.workflow],
    prompt: [
      `Run the plugin workflow \`${fullName}\` now with the \`${TOOL.workflow}\` tool: name "${fullName}", and as args the input below — JSON (a list or an object) when it reads as structured data, a string otherwise, and no args when it is empty.`,
      'A token target in the input, such as "+500k", is not an arg: pass it as budget (500000).',
      'The run goes on in the background: say it started, and answer with its result when it arrives.',
      '',
      'Input: $ARGUMENTS',
    ].join('\n'),
  }
}

/** Add a discovered plugin's workflows to its commands; a command of the same name keeps it. */
export function withWorkflowCommands(plugin: DiscoveredPlugin): DiscoveredPlugin {
  const workflows = plugin.entrypoints.components?.workflows ?? []
  if (workflows.length === 0) return plugin
  const taken = new Set(plugin.commands.map((command) => command.name))
  const added = workflows
    .filter((workflow) => !taken.has(workflow.name))
    .map((workflow) => workflowCommand(plugin.manifest.name, workflow))
  if (added.length === 0) return plugin
  return {
    ...plugin,
    commands: [...plugin.commands, ...added],
    provides: {
      ...plugin.provides,
      commands: [...plugin.provides.commands, ...added.map((command) => command.name)],
    },
  }
}

/** The workflows of the plugins enabled for one scope, as the `workflow` tool runs them. */
export async function listEnabledPluginWorkflows(opts: {
  repo: CapabilitySourceRepository
  availability: AvailabilityReader
  userId: string
  projectId: string
  cwd: string
  homeDir: string
}): Promise<WorkflowEntry[]> {
  const catalog = await buildPluginCatalog(opts)
  return catalog.enabled.flatMap(({ plugin }) =>
    (plugin.entrypoints.components?.workflows ?? []).map((workflow) => ({
      fullName: `${plugin.manifest.name}:${workflow.name}`,
      description: workflow.description,
      file: workflow.file,
    })),
  )
}
