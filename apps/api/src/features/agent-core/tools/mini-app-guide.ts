import { promises as fs } from 'node:fs'
import { z } from 'zod'
import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import { TOOL } from '../tool-names'

/**
 * `mini_app_guide` — what the agent reads before it first uses a mini app.
 *
 * A mini app's `guide.md` says which of its tools does what and what to tell the person. Twenty
 * guides held in the system prompt cost every turn about twenty thousand tokens, so the prompt
 * lists each enabled mini app in one line and the agent reads a guide when it needs one, as it
 * reads a skill. The guide belongs to the mini app, not to a plugin: a mini app holds no skills.
 */
export interface MiniAppGuide {
  /** The mini app's name. */
  app: string
  /** The guide's absolute path, already contained in the mini app's folder. */
  file: string
}

/** A guide is instructions, not a document: past this it is cut, and says so. */
export const MINI_APP_GUIDE_MAX_CHARS = 32_000

const inputSchema = z.object({
  app: z.string().describe('The mini app, by the name the prompt lists it under.'),
})

const READ: CallClass = { effect: 'read' }

export function createMiniAppGuideTool(guides: readonly MiniAppGuide[]) {
  return defineAgentTool({
    name: TOOL.mini_app_guide,
    description:
      "Read an enabled mini app's guide: which of its tools does what, and what to tell the person. Read it before you first use the app.",
    activeVerb: 'Reading the mini app guide',
    inputSchema,
    mutates: false,
    classify: () => READ,
    async execute(_toolCallId, input) {
      const app = input.app.trim()
      const guide = guides.find((entry) => entry.app === app)
      if (!guide) {
        const known = guides.map((entry) => entry.app).join(', ') || 'none'
        return {
          content: `No enabled mini app called "${app}" has a guide. Mini apps with one: ${known}.`,
          isError: true,
        }
      }
      let text: string
      try {
        text = await fs.readFile(guide.file, 'utf8')
      } catch {
        return { content: `The ${app} mini app ships no guide.`, isError: true }
      }
      if (text.length <= MINI_APP_GUIDE_MAX_CHARS) return { content: text }
      return {
        content: `${text.slice(0, MINI_APP_GUIDE_MAX_CHARS)}\n\n[The guide was cut at ${MINI_APP_GUIDE_MAX_CHARS} characters.]`,
      }
    },
  })
}
