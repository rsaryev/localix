import { defineAgentTool, type CallClass } from '@localixai/agent/agents'
import { z } from 'zod'

import { TOOL } from '../tool-names'

const SKIP_ANSWER_CLASS: CallClass = { effect: 'read' }

/**
 * A participant's explicit pass: it was named but nothing is asked of it.
 *
 * Every `@handle` in a reply gives that participant the floor, and a turn had to end with a
 * message, so a colleague named only in passing ("I will pass your choice to @gamer") answered
 * anyway; its reply went back as a report, the leader named it again, and the two traded the
 * same result until the hop limit (LOCALIX-185). The call ends the turn at once, its row is
 * hidden, and the host routes nothing on it (`finalize.ts`).
 */
export function createSkipAnswerTool() {
  return defineAgentTool<Record<string, never>>({
    name: TOOL.skip_answer,
    label: 'Skip answer',
    activeVerb: 'Skipping',
    presentation: { transcript: 'hidden' },
    description:
      'Pass this turn without a message: it ends at once, hidden, and the floor moves on. Call it alone.',
    inputSchema: z.strictObject({}),
    mutates: false,
    classify: () => SKIP_ANSWER_CLASS,
    executionMode: 'sequential',
    async execute() {
      return { content: 'Skipped.', terminate: true }
    },
  })
}
