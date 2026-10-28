import { dirname } from 'node:path'

import type { AvailabilityReader } from '../capabilities/availability'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { TOOL } from '../agent-core/tool-names'
import type { WorkflowEntry } from '../agent-core/tools/workflow/workflow'
import { buildPluginCatalog } from './catalog'
import { listFolderWorkflows } from './folder-workflows'
import type { PluginCommand } from './contracts'
import type { DiscoveredPlugin } from './discovery-types'
import type { PluginWorkflow } from './discovery-cc-components'

/**
 * A plugin's workflows as its commands: `/<plugin>:<name>`, as Claude Code names them. The command
 * asks the agent to run the workflow with the `Workflow` tool and activates that tool for the
 * chat; the person's input becomes the workflow's `args`.
 */

export function workflowCommand(
  pluginName: string | null,
  workflow: Pick<PluginWorkflow, 'name' | 'description'>,
): PluginCommand {
  // A workflow kept in a folder is `/<name>`; a plugin's is `/<plugin>:<name>`.
  const fullName = pluginName ? `${pluginName}:${workflow.name}` : workflow.name
  return {
    name: workflow.name,
    description: workflow.description,
    args: [],
    argumentHint: '[input]',
    activateTools: [TOOL.Workflow],
    prompt: [
      `Run the workflow \`${fullName}\` now with the \`${TOOL.Workflow}\` tool: name "${fullName}", and as args the input below — JSON (a list or an object) when it reads as structured data, a string otherwise, and no args when it is empty.`,
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

/**
 * The workflows of one scope as the `Workflow` tool runs them: those in the project's and the
 * user's `workflows` folders, then those of the enabled plugins.
 */
export async function listEnabledPluginWorkflows(opts: {
  repo: CapabilitySourceRepository
  availability: AvailabilityReader
  userId: string
  projectId: string
  cwd: string
  homeDir: string
}): Promise<WorkflowEntry[]> {
  const catalog = await buildPluginCatalog(opts)
  const folders = await listFolderWorkflows(opts)
  return folders.concat(
    catalog.enabled.flatMap(({ plugin }) =>
      (plugin.entrypoints.components?.workflows ?? []).map((workflow) => ({
        fullName: `${plugin.manifest.name}:${workflow.name}`,
        description: workflow.description,
        file: workflow.file,
      })),
    ),
  )
}

/** The workflows kept in folders as commands: `/<name>`, with the folder's script as their home. */
export async function folderWorkflowCommands(opts: {
  cwd: string
  homeDir: string
}): Promise<Array<{ plugin: string; command: PluginCommand; pluginDir: string }>> {
  return (await listFolderWorkflows(opts)).map((entry) => ({
    plugin: entry.fullName,
    command: workflowCommand(null, { name: entry.fullName, description: entry.description }),
    pluginDir: dirname(entry.file),
  }))
}
