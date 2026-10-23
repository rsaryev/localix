import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import { TOOL } from '../tool-names'

/**
 * `mini_app_build` — the agent's only way to build, verify and reload a mini app the USER owns.
 *
 * The defect it replaces: the agent used to be told to run a verification script from the
 * Localix source checkout, so building a mini app meant working inside the application's own
 * repository, and on an installed app there was no such script at all. The host owns the build
 * (backend, UI, the app's tests, template leftovers) and the reload; the agent only names the
 * app. Creation rides the same call — a description forks the reference template into a NEW
 * mini app under the first free name — so an agent that chose an app's name never needs another
 * way in.
 */
export interface MiniAppBuildToolOptions {
  /** Build (creating first when asked) and reload one of the user's mini apps; the text is the report. */
  run(input: {
    name: string
    title?: string
    description?: string
  }): Promise<{ text: string; ok: boolean }>
}

const inputSchema = z.object({
  name: z.string().describe('Its folder in ~/.localix/mini-apps, lower-kebab-case.'),
  title: z.string().optional().describe('With description: the name people see.'),
  description: z
    .string()
    .optional()
    .describe(
      'Only to CREATE one: an English sentence on what it does. A taken name gets a free one, which the result names.',
    ),
})

const MINI_APP_BUILD_CLASS: CallClass = { effect: 'external' }

export function createMiniAppBuildTool(options: MiniAppBuildToolOptions) {
  return defineAgentTool({
    name: TOOL.mini_app_build,
    description:
      "Build, test and reload one of the user's own mini apps in the running app. Call it after editing one and fix what it reports.",
    activeVerb: 'Building mini app',
    inputSchema,
    // Writes the build output, runs the app's own tests and reloads code the host runs — a
    // process whose effects nothing can predict, so `external`, declared rather than left to the
    // static-flag fallback that happens to give the same answer.
    mutates: true,
    classify: () => MINI_APP_BUILD_CLASS,
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
