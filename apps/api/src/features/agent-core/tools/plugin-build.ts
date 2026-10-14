import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import { TOOL } from '../tool-names'

/**
 * `plugin_build` — the agent's only way to build, verify and reload a USER plugin.
 *
 * The defect it replaces: the agent used to be told to run a verification script from the
 * Localix source checkout, so building a plugin meant working inside the application's own
 * repository, and on an installed app there was no such script at all. The host owns the build
 * (backend, UI, the plugin's tests, template leftovers) and the reload; the agent only names the
 * plugin. Creation rides the same call — a description forks the reference template into a NEW
 * plugin under the first free name — so an agent that chose a plugin's name never needs another
 * way in.
 */
export interface PluginBuildToolOptions {
  /** Build (creating first when asked) and reload one user plugin; the text is the report. */
  run(input: {
    name: string
    title?: string
    description?: string
  }): Promise<{ text: string; ok: boolean }>
}

const inputSchema = z.object({
  name: z.string().describe('Its folder under ~/.localix/plugins, lower-kebab-case.'),
  title: z.string().optional().describe('With description: the name people see.'),
  description: z
    .string()
    .optional()
    .describe(
      'Only to CREATE a plugin: one English sentence on what it does. A taken name gets a free one, which the result names.',
    ),
})

const PLUGIN_BUILD_CLASS: CallClass = { effect: 'external' }

export function createPluginBuildTool(options: PluginBuildToolOptions) {
  return defineAgentTool({
    name: TOOL.plugin_build,
    description:
      "Build, test and reload one of the user's own Localix plugins in the running app. Call it after editing a plugin and fix what it reports.",
    activeVerb: 'Building plugin',
    inputSchema,
    // Writes the build output, runs the plugin's own tests and reloads code the host runs — a
    // process whose effects nothing can predict, so `external`, declared rather than left to the
    // static-flag fallback that happens to give the same answer.
    mutates: true,
    classify: () => PLUGIN_BUILD_CLASS,
    executionMode: 'sequential',
    async execute(_toolCallId, input) {
      const result = await options.run({
        name: input.name.trim(),
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      })
      return { content: result.text, isError: !result.ok }
    },
  })
}
