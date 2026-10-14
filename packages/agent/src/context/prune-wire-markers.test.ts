import { expect, test } from 'bun:test'
import type { Message } from '../types'
import { CRUSH_MARKER } from './crushers'
import { ELISION_MARKER } from './op-menu'
import {
  collectElidedArgToolCallIds,
  collectElidedToolCallIds,
  MIDDLE_TRUNCATE_MARKER,
} from './prune-wire'

function history(text: string): Message[] {
  return [
    {
      role: 'assistant',
      model: 'fixture',
      timestamp: 0,
      content: [{ type: 'tool_call', id: 'call', name: 'write', arguments: { content: text } }],
    },
    {
      role: 'tool',
      timestamp: 1,
      results: [
        { type: 'tool_result', toolCallId: 'call', toolName: 'write', content: text },
        {
          type: 'tool_result',
          toolCallId: 'rich-call',
          toolName: 'write',
          content: [{ type: 'text', text }],
        },
      ],
    },
  ]
}

test('result markers include structural crushes while argument markers retain their narrower contract', () => {
  for (const marker of [ELISION_MARKER, MIDDLE_TRUNCATE_MARKER, CRUSH_MARKER]) {
    const messages = history(`[${marker} — fixture]`)
    expect(collectElidedToolCallIds(messages)).toEqual(['call', 'rich-call'])
    expect(collectElidedArgToolCallIds(messages)).toEqual(marker === CRUSH_MARKER ? [] : ['call'])
  }
})

test('literal marker words in ordinary prose do not report discarded bytes', () => {
  for (const marker of [ELISION_MARKER, MIDDLE_TRUNCATE_MARKER, CRUSH_MARKER]) {
    const messages = history(`The phrase ${marker} is ordinary input here.`)
    expect(collectElidedToolCallIds(messages)).toEqual([])
    expect(collectElidedArgToolCallIds(messages)).toEqual([])
  }
})
