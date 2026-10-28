import { describe, expect, it } from 'bun:test'
import type { Message, ToolResult } from '../types'
import { ELISION_MARKER } from './op-menu'
import { pruneWireMessages, type PruneWireOptions } from './prune-wire'

const contentOf = (messages: Message[], id: string): string | undefined => {
  const content = messages
    .flatMap((message) => (message.role === 'tool' ? message.results : []))
    .find((result) => result.toolCallId === id)?.content
  return typeof content === 'string' ? content : undefined
}

const toolMessage = (result: ToolResult): Message => ({
  role: 'tool',
  results: [result],
  timestamp: 0,
})

const OPEN: PruneWireOptions = {
  keepRecentTokens: 0,
  minKeepRecent: 1,
  boundaryQuantum: 1,
}

const readHistory = (result: ToolResult): Message[] => [
  { role: 'user', content: 'task', timestamp: 0 },
  {
    role: 'assistant',
    content: [
      {
        type: 'tool_call',
        id: result.toolCallId,
        name: 'Read',
        arguments: { path: 'a.ts' },
      },
    ],
    model: 'm',
    timestamp: 0,
  },
  toolMessage(result),
  { role: 'user', content: 'done', timestamp: 0 },
]

describe('pruneWireMessages identity memoization', () => {
  it('memoizes fresh-result bounds by result object, not equal content', () => {
    const result: ToolResult = {
      type: 'tool_result',
      toolCallId: 'bash-1',
      toolName: 'Bash',
      content: 'A'.repeat(60_000),
    }
    const first = contentOf(pruneWireMessages([toolMessage(result)]), 'bash-1')

    // Deliberately violate the production immutability invariant to make the cache key
    // observable: a second computation would see B, while an identity hit retains A.
    result.content = 'B'.repeat(60_000)
    const sameObject = contentOf(pruneWireMessages([toolMessage(result)]), 'bash-1')
    const equalNewObject = contentOf(pruneWireMessages([toolMessage({ ...result })]), 'bash-1')

    expect(first).toContain('A')
    expect(sameObject).toBe(first)
    expect(equalNewObject).toContain('B')
    expect(equalNewObject).not.toBe(first)
  })

  it('memoizes live-read analysis by history object, not equal content', () => {
    const initialContent = 'A'.repeat(800)
    const result: ToolResult = {
      type: 'tool_result',
      toolCallId: 'read-1',
      toolName: 'Read',
      content: initialContent,
    }
    const history = readHistory(result)
    const opts = { ...OPEN, liveReadBudgetBytes: 800 }
    expect(contentOf(pruneWireMessages(history, opts), 'read-1')).toBe(initialContent)

    // As above, mutation is only a probe: replacing a member of the same history
    // object would force a second scan, while a history-identity hit retains the first.
    const replacementContent = 'B'.repeat(801)
    const replacement = { ...result, content: replacementContent }
    history[2] = toolMessage(replacement)
    expect(contentOf(pruneWireMessages(history, opts), 'read-1')).toBe(replacementContent)

    const equalNewHistory = history.slice()
    expect(contentOf(pruneWireMessages(equalNewHistory, opts), 'read-1')).toContain(ELISION_MARKER)
  })

  it('memoizes read byte lengths by result object, not equal content', () => {
    const initialContent = 'A'.repeat(800)
    const result: ToolResult = {
      type: 'tool_result',
      toolCallId: 'read-2',
      toolName: 'Read',
      content: initialContent,
    }
    const opts = { ...OPEN, liveReadBudgetBytes: 800 }
    expect(contentOf(pruneWireMessages(readHistory(result), opts), 'read-2')).toBe(initialContent)

    // A new history forces live-read analysis, isolating the nested result cache:
    // the same result identity retains one byte-length computation; an equal new
    // result object is measured again.
    const replacementContent = 'B'.repeat(801)
    result.content = replacementContent
    expect(contentOf(pruneWireMessages(readHistory(result), opts), 'read-2')).toBe(
      replacementContent,
    )
    expect(contentOf(pruneWireMessages(readHistory({ ...result }), opts), 'read-2')).toContain(
      ELISION_MARKER,
    )
  })
})
