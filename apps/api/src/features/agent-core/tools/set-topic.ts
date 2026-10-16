import { defineAgentTool, type CallClass } from '@localixai/agent/agents'

import { z } from 'zod'

import { sessionTopicSchema, type SessionTopic } from '../session-topic'
import { TOOL } from '../tool-names'

export interface SetTopicPort {
  save(toolCallId: string, topic: SessionTopic): Promise<void>
}

const SET_TOPIC_CLASS: CallClass = { effect: 'session' }

/** The topic as the model writes it: snake_case, like every model-facing field. */
const setTopicInputSchema = z.strictObject({
  title: sessionTopicSchema.shape.title,
  goal: sessionTopicSchema.shape.goal,
  previous_topic_summary: sessionTopicSchema.shape.previousTopicSummary,
})
type SetTopicInput = z.infer<typeof setTopicInputSchema>

/** The goal as one sentence: a goal the model already ended with a period must not end in "..". */
const sentence = (text: string): string => {
  const trimmed = text.trim()
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * Start a new session topic and keep working in the same turn.
 *
 * It used to be a field of the terminal turn-control call, which ended the turn and queued the
 * speaker again to "continue in fresh context". The fresh run met a request already moved out of
 * its history, set the topic again and queued itself again: four empty turns in a live chat. Now
 * the boundary is placed before the request that opens the topic, so this turn and every later one
 * keep the request and the work done on it, and nothing needs a second run.
 */
export function createSetTopicTool(port: SetTopicPort) {
  return defineAgentTool<SetTopicInput>({
    name: TOOL.set_topic,
    label: 'Session topic',
    activeVerb: 'Saving the topic',
    presentation: { transcript: 'hidden' },
    description:
      'Start a new session topic, then keep working in this turn. Context before the request that opened it is replaced by previous_topic_summary for every participant.',
    inputSchema: setTopicInputSchema,
    mutates: true,
    classify: () => SET_TOPIC_CLASS,
    executionMode: 'sequential',
    async execute(toolCallId, input) {
      await port.save(toolCallId, {
        title: input.title,
        goal: input.goal,
        previousTopicSummary: input.previous_topic_summary,
      })
      return {
        content: `Topic saved: ${input.title}. Goal: ${sentence(input.goal)} From your next model call on, everything before the request that opened this topic is replaced by previous_topic_summary. Continue the work now; do not set the topic again.`,
      }
    },
  })
}
