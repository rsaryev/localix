import { describe, expect, it } from 'bun:test'
import type { ImageContent, Message, TextContent, ToolCall, ToolResult } from '../types'
import { textEncoderByteLength } from '../utils/hash'
import { DEFAULT_MAX_BYTES } from '../utils/truncate'
import { ELISION_MARKER } from './op-menu'
import {
  collectElidedArgToolCallIds,
  collectElidedToolCallIds,
  pruneWireMessages,
} from './prune-wire'
import { registerContextToolClasses } from './tool-classes'

const call = (id: string, name: string, args: unknown): Message => ({
  role: 'assistant',
  content: [{ type: 'tool_call', id, name, arguments: args } satisfies ToolCall],
  model: 'model',
  timestamp: 0,
})

const result = (id: string, name: string, content: string): Message => ({
  role: 'tool',
  results: [{ type: 'tool_result', toolCallId: id, toolName: name, content } satisfies ToolResult],
  timestamp: 0,
})

const contentOf = (messages: Message[], id: string): string => {
  for (const message of messages) {
    if (message.role !== 'tool') continue
    const found = message.results.find((candidate) => candidate.toolCallId === id)
    if (found && typeof found.content === 'string') return found.content
  }
  throw new Error(`missing result ${id}`)
}

const argsOf = (messages: Message[], id: string): Record<string, unknown> => {
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const found = message.content.find((part) => part.type === 'tool_call' && part.id === id) as
      | ToolCall
      | undefined
    const args = found?.arguments
    if (args && typeof args === 'object') {
      return args as Record<string, unknown>
    }
  }
  throw new Error(`missing call ${id}`)
}

describe('pruneWireMessages — fresh tool-result hard bound', () => {
  it('bounds a newest command result even though the recent tail and pressure gate protect it', () => {
    const huge = `HEAD\n${'x'.repeat(DEFAULT_MAX_BYTES + 8_000)}\nTAIL_DIAGNOSTIC`
    const messages: Message[] = [
      { role: 'user', content: 'run it', timestamp: 0 },
      call('bash-1', 'Bash', { command: 'run' }),
      result('bash-1', 'Bash', huge),
    ]

    const pruned = pruneWireMessages(messages, {
      keepRecentTokens: 1_000_000,
      minKeepRecent: 10,
      pressureTokens: 1_000_000,
    })
    const output = contentOf(pruned, 'bash-1')

    expect(output).toContain(ELISION_MARKER)
    expect(output).toContain('TAIL_DIAGNOSTIC')
    expect(output).not.toContain('HEAD\n')
    expect(output).toContain('ToolOutput(action="get", tool_call_id="bash-1")')
    expect(textEncoderByteLength(output)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES)
    expect(collectElidedToolCallIds(pruned)).toContain('bash-1')
    // Wire-only: neither the caller's message nor its durable result is mutated.
    expect(contentOf(messages, 'bash-1')).toBe(huge)
  })

  it('keeps a UTF-8-safe tail for a fresh plugin result', () => {
    const huge = `START\n${'界'.repeat(DEFAULT_MAX_BYTES)}\nTAIL_MARK`
    const messages: Message[] = [
      { role: 'user', content: 'inspect it', timestamp: 0 },
      call('plugin-1', 'plugin_report', { topic: 'large' }),
      result('plugin-1', 'plugin_report', huge),
    ]

    const output = contentOf(
      pruneWireMessages(messages, { keepRecentTokens: 1_000_000, minKeepRecent: 10 }),
      'plugin-1',
    )

    expect(output).not.toContain('START\n')
    expect(output).not.toContain('\uFFFD')
    expect(output).toContain('TAIL_MARK')
    expect(output).toContain(ELISION_MARKER)
    expect(textEncoderByteLength(output)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES)
  })

  it('preserves identity and the exact threshold when no hard bound is needed', () => {
    const messages: Message[] = [
      { role: 'user', content: 'run it', timestamp: 0 },
      call('bash-1', 'Bash', { command: 'run' }),
      result('bash-1', 'Bash', 'x'.repeat(DEFAULT_MAX_BYTES)),
    ]

    expect(
      pruneWireMessages(messages, {
        keepRecentTokens: 1_000_000,
        minKeepRecent: 10,
        pressureTokens: 1_000_000,
      }),
    ).toBe(messages)
  })

  it('shares one text budget across rich content while preserving media', () => {
    const image: ImageContent = { type: 'image', mediaType: 'image/png', data: 'AAAA' }
    const content: Array<TextContent | ImageContent> = [
      { type: 'text', text: `OLD_HEAD\n${'a'.repeat(DEFAULT_MAX_BYTES)}` },
      image,
      { type: 'text', text: `${'界'.repeat(8_000)}\nTAIL_DIAGNOSTIC` },
    ]
    const messages: Message[] = [
      { role: 'user', content: 'inspect it', timestamp: 0 },
      call('rich-1', 'plugin_report', {}),
      {
        role: 'tool',
        results: [
          { type: 'tool_result', toolCallId: 'rich-1', toolName: 'plugin_report', content },
        ],
        timestamp: 0,
      },
    ]

    const pruned = pruneWireMessages(messages, {
      keepRecentTokens: 1_000_000,
      pressureTokens: 1_000_000,
    })
    const result = (pruned[2] as Extract<Message, { role: 'tool' }>).results[0]
    expect(Array.isArray(result.content)).toBe(true)
    const parts = result.content as Array<TextContent | ImageContent>
    const text = parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')

    expect(parts.filter((part) => part.type === 'image')).toEqual([image])
    expect(text).toContain(ELISION_MARKER)
    expect(text).toContain('TAIL_DIAGNOSTIC')
    expect(text).not.toContain('OLD_HEAD')
    expect(text).not.toContain('\uFFFD')
    expect(textEncoderByteLength(text)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES)
    expect(collectElidedToolCallIds(pruned)).toContain('rich-1')
    // The durable source remains rich and byte-for-byte intact.
    expect((messages[2] as Extract<Message, { role: 'tool' }>).results[0].content).toBe(content)
  })

  it('head-bounds a dynamically registered read tool but leaves core paged readers alone', () => {
    registerContextToolClasses({ readResult: ['plugin_catalog_read'] })
    const huge = `FIRST_RECORD\n${'x'.repeat(DEFAULT_MAX_BYTES + 8_000)}\nLAST_RECORD`
    const pluginMessages: Message[] = [
      { role: 'user', content: 'catalog', timestamp: 0 },
      call('catalog-1', 'plugin_catalog_read', {}),
      result('catalog-1', 'plugin_catalog_read', huge),
    ]
    const bounded = contentOf(
      pruneWireMessages(pluginMessages, {
        keepRecentTokens: 1_000_000,
        pressureTokens: 1_000_000,
      }),
      'catalog-1',
    )

    expect(bounded).toContain('FIRST_RECORD')
    expect(bounded).not.toContain('LAST_RECORD')
    expect(bounded).toContain('showing beginning')
    expect(bounded).toContain('ToolOutput(action="get", tool_call_id="catalog-1")')
    expect(textEncoderByteLength(bounded)).toBeLessThanOrEqual(DEFAULT_MAX_BYTES)

    const coreMessages: Message[] = [
      { role: 'user', content: 'file', timestamp: 0 },
      call('read-1', 'Read', { path: 'large.txt' }),
      result('read-1', 'Read', huge),
    ]
    expect(
      pruneWireMessages(coreMessages, {
        keepRecentTokens: 1_000_000,
        pressureTokens: 1_000_000,
      }),
    ).toBe(coreMessages)
  })

  it('counts the truncation marker inside the 2,000-line hard limit', () => {
    const huge = Array.from({ length: 2_500 }, (_, index) => `line ${index}`).join('\n')
    const messages: Message[] = [
      { role: 'user', content: 'run it', timestamp: 0 },
      call('lines-1', 'plugin_report', {}),
      result('lines-1', 'plugin_report', huge),
    ]
    const output = contentOf(pruneWireMessages(messages), 'lines-1')
    expect(output.split('\n')).toHaveLength(2_000)
    expect(output).toContain(ELISION_MARKER)
  })
})

describe('pruneWireMessages — fresh successful mutation-argument hard bound', () => {
  it('bounds a newest successful write before tail and pressure gates can protect it', () => {
    const original = `BEGIN\n${'x'.repeat(DEFAULT_MAX_BYTES + 8_000)}\nEND`
    const messages: Message[] = [
      { role: 'user', content: 'write it', timestamp: 0 },
      call('write-1', 'Write', { path: 'large.ts', content: original }),
      result('write-1', 'Write', 'Wrote large.ts'),
    ]

    const pruned = pruneWireMessages(messages, {
      keepRecentTokens: 1_000_000,
      minKeepRecent: 10,
      pressureTokens: 1_000_000,
    })
    const args = argsOf(pruned, 'write-1')

    expect(args.content).toContain(ELISION_MARKER)
    expect(args.content).toContain('ToolOutput(action="get", tool_call_id="write-1")')
    expect(textEncoderByteLength(JSON.stringify(args))).toBeLessThanOrEqual(DEFAULT_MAX_BYTES)
    expect(collectElidedArgToolCallIds(pruned)).toContain('write-1')
    expect(argsOf(messages, 'write-1').content).toBe(original)
  })

  it('uses UTF-8 bytes and bounds jointly oversized edit fields largest-first', () => {
    const oldString = '界'.repeat(12_000)
    const newString = 'n'.repeat(30_000)
    const messages: Message[] = [
      { role: 'user', content: 'edit it', timestamp: 0 },
      call('edit-1', 'Edit', { path: 'large.ts', old_string: oldString, new_string: newString }),
      result('edit-1', 'Edit', 'Edited large.ts'),
    ]

    const args = argsOf(pruneWireMessages(messages), 'edit-1')
    expect(args.old_string).toContain(ELISION_MARKER)
    expect(args.new_string).toBe(newString)
    expect(textEncoderByteLength(JSON.stringify(args))).toBeLessThanOrEqual(DEFAULT_MAX_BYTES)
  })

  it('keeps failed and still-pending mutation arguments verbatim', () => {
    const original = 'x'.repeat(DEFAULT_MAX_BYTES + 8_000)
    const failed: Message[] = [
      { role: 'user', content: 'write it', timestamp: 0 },
      call('failed-1', 'Write', { path: 'large.ts', content: original }),
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'failed-1',
            toolName: 'Write',
            content: 'EACCES',
            isError: true,
          },
        ],
        timestamp: 0,
      },
    ]
    const pending = failed.slice(0, 2)

    expect(argsOf(pruneWireMessages(failed), 'failed-1').content).toBe(original)
    expect(argsOf(pruneWireMessages(pending), 'failed-1').content).toBe(original)
  })

  it('fails closed when a malformed history has conflicting results for one call id', () => {
    const original = 'x'.repeat(DEFAULT_MAX_BYTES + 8_000)
    const messages: Message[] = [
      { role: 'user', content: 'write it', timestamp: 0 },
      call('mixed-1', 'Write', { path: 'large.ts', content: original }),
      result('mixed-1', 'Write', 'Wrote large.ts'),
      {
        role: 'tool',
        results: [
          {
            type: 'tool_result',
            toolCallId: 'mixed-1',
            toolName: 'Write',
            content: 'later repair says failed',
            isError: true,
          },
        ],
        timestamp: 0,
      },
    ]

    expect(argsOf(pruneWireMessages(messages), 'mixed-1').content).toBe(original)
  })
})
