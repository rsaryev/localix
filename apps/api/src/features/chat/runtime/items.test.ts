import { describe, expect, test } from 'bun:test'
import { createSetTopicTool } from '../../agent-core/tools/set-topic'
import { indexToolPresentation } from './run/tool-assembly'
import { isTranscriptItemHidden } from '../item-format'

import {
  buildToolItem,
  classifyTool,
  createItemAccumulator,
  textItem,
  reasoningItem,
  type ToolItemSpec,
} from './items'
import type {
  CommandItem,
  FileChangeItem,
  McpCallItem,
  ToolCallItem,
} from '@localixai/agent/agents'

describe('textItem / reasoningItem', () => {
  test('textItem builds a text item, defaulting status to running', () => {
    expect(textItem('t1', 'hello', 0)).toEqual({
      id: 't1',
      type: 'text',
      status: 'running',
      text: 'hello',
      turnIndex: 0,
    })
  })
  test('reasoningItem builds a reasoning item and honours an explicit status', () => {
    expect(reasoningItem('r1', 'thinking…', 2, 'completed')).toEqual({
      id: 'r1',
      type: 'reasoning',
      status: 'completed',
      text: 'thinking…',
      turnIndex: 2,
    })
  })
})

describe('createItemAccumulator content order', () => {
  test('descriptor visibility survives streaming, completion and persisted JSON', () => {
    const tool = createSetTopicTool({ save: async () => {} })
    const descriptors = indexToolPresentation([tool])
    const acc = createItemAccumulator(() => 'Updating', {
      presentationFor: (name) => descriptors.get(name)?.presentation,
    })
    acc.streamTool(0, {
      id: 'finish',
      name: tool.name,
      arguments: { title: 'T' },
    })
    expect(isTranscriptItemHidden(acc.list()[0]!)).toBe(true)
    acc.startTool(0, 'finish', tool.name, { title: 'T' })
    expect(isTranscriptItemHidden(acc.list()[0]!)).toBe(true)
    acc.endTool('finish', tool.name, {
      status: 'completed',
      resultText: 'Topic saved: T.',
    })
    const restored = JSON.parse(JSON.stringify(acc.list()[0])) as ToolCallItem
    expect(restored.presentation).toEqual({ transcript: 'hidden' })
    expect(restored.resultText).toBe('Topic saved: T.')
    expect(isTranscriptItemHidden(restored)).toBe(true)
  })

  test('sorts narrative and tools by provider contentIndex while preserving signatures', () => {
    const acc = createItemAccumulator(() => 'Running')
    acc.text(0, 'A', 0, { textSignature: 'text-sig' })
    acc.streamTool(0, {
      id: 'c1',
      name: 'read',
      arguments: {},
      contentIndex: 1,
      thoughtSignature: 'sig',
      api: 'google-generative-ai',
      provider: 'google',
      model: 'gemini-3',
    })
    acc.text(0, 'B', 2)
    expect(acc.list().map((item) => item.id)).toEqual(['text-0', 'c1', 'text-0-2'])
    expect(acc.list()[1]).toMatchObject({
      contentIndex: 1,
      thoughtSignature: 'sig',
      provider: 'google',
      model: 'gemini-3',
    })
  })
})

const spec = (over: Partial<ToolItemSpec> & Pick<ToolItemSpec, 'name'>): ToolItemSpec => ({
  toolCallId: 'tc1',
  status: 'completed',
  activeVerb: 'Running',
  ...over,
})

describe('classifyTool', () => {
  test('maps known tools to specialized types, rest to tool_call/mcp_call', () => {
    expect(classifyTool('bash')).toBe('command')
    expect(classifyTool('write')).toBe('file_change')
    expect(classifyTool('edit')).toBe('file_change')
    // The removed patch tool is no longer callable, so its name is not a file mutation.
    expect(classifyTool('apply_patch')).toBe('tool_call')
    expect(classifyTool('read')).toBe('tool_call')
    expect(classifyTool('agents')).toBe('tool_call')
    expect(classifyTool('database_lookup')).toBe('tool_call')
    expect(classifyTool('mcp__github__create_issue')).toBe('mcp_call')
    // Single-underscore prefix is a SEPARATE condition in the OR — pin it too.
    expect(classifyTool('mcp_legacy_tool')).toBe('mcp_call')
  })
})

describe('buildToolItem', () => {
  test('bash → command item with exitCode/duration/output from details', () => {
    const item = buildToolItem(
      spec({
        name: 'bash',
        input: { command: 'ls -la' },
        details: {
          command: 'ls -la',
          cwd: '/work',
          output: 'a\nb',
          exitCode: 0,
          wallTimeMs: 42,
          isBackground: false,
        },
        resultText: 'a\nb',
      }),
    ) as CommandItem
    expect(item.type).toBe('command')
    expect(item).toMatchObject({
      command: 'ls -la',
      cwd: '/work',
      output: 'a\nb',
      exitCode: 0,
      durationMs: 42,
      toolCallId: 'tc1',
      name: 'bash',
    })
  })

  test('bash streaming (no details) still shows command from input', () => {
    const item = buildToolItem(
      spec({ name: 'bash', status: 'running', input: { command: 'npm test' } }),
    ) as CommandItem
    expect(item).toMatchObject({
      type: 'command',
      command: 'npm test',
      status: 'running',
    })
  })

  test('write → file_change (add when created) with diff', () => {
    const item = buildToolItem(
      spec({
        name: 'write',
        input: { path: 'a.ts' },
        details: { path: 'a.ts', created: true, diff: '+x' },
      }),
    ) as FileChangeItem
    expect(item.type).toBe('file_change')
    expect(item.changes).toEqual([{ path: 'a.ts', kind: 'add', diff: '+x' }])
  })

  test('write → file_change (modify when not created)', () => {
    const item = buildToolItem(
      spec({
        name: 'write',
        details: { path: 'b.ts', created: false, diff: '-x\n+y' },
      }),
    ) as FileChangeItem
    expect(item.changes).toEqual([{ path: 'b.ts', kind: 'modify', diff: '-x\n+y' }])
  })

  test('a batched edit → one change per file, the failed file included with its reason', () => {
    const item = buildToolItem(
      spec({
        name: 'edit',
        details: {
          cwd: '/w',
          files: [
            { path: '/w/a.ts', diff: '-a\n+b', replacements: 1 },
            { path: '/w/b.ts', failed: true, error: 'edits[1]: `old_string` was not found' },
          ],
        },
      }),
    ) as FileChangeItem
    expect(item.changes).toEqual([
      { path: '/w/a.ts', kind: 'modify', diff: '-a\n+b' },
      {
        path: '/w/b.ts',
        kind: 'modify',
        failed: true,
        failReason: 'edits[1]: `old_string` was not found',
      },
    ])
  })

  test('a batched write → add for a created file, modify for a replaced one', () => {
    const item = buildToolItem(
      spec({
        name: 'write',
        details: {
          cwd: '/w',
          files: [
            { path: '/w/new.ts', created: true, diff: undefined },
            { path: '/w/old.ts', created: false, diff: '-x\n+y' },
          ],
        },
      }),
    ) as FileChangeItem
    expect(item.changes).toEqual([
      { path: '/w/new.ts', kind: 'add', diff: undefined },
      { path: '/w/old.ts', kind: 'modify', diff: '-x\n+y' },
    ])
  })

  test('a streaming batch (no details yet) → every path the input names', () => {
    const item = buildToolItem(
      spec({
        name: 'edit',
        status: 'pending',
        input: {
          edits: [
            { path: 'src/a.ts', old_string: 'x' },
            { path: 'src/b.ts' },
            { path: 'src/a.ts' },
          ],
        },
      }),
    ) as FileChangeItem
    expect(item.changes).toEqual([
      { path: 'src/a.ts', kind: 'modify' },
      { path: 'src/b.ts', kind: 'modify' },
    ])
  })

  test('edit streaming (no details yet) → path from input', () => {
    const item = buildToolItem(
      spec({ name: 'edit', status: 'pending', input: { path: 'src/a.ts' } }),
    ) as FileChangeItem
    expect(item.changes).toEqual([{ path: 'src/a.ts', kind: 'modify' }])
  })

  test('mcp__server__tool → mcp_call with parsed server/tool', () => {
    const item = buildToolItem(
      spec({
        name: 'mcp__github__create_issue',
        input: { title: 'x' },
        details: { ok: true },
      }),
    ) as McpCallItem
    expect(item).toMatchObject({
      type: 'mcp_call',
      server: 'github',
      tool: 'create_issue',
      result: { ok: true },
    })
  })

  test('unknown/plugin tool → generic tool_call carrying details as output', () => {
    const item = buildToolItem(
      spec({
        name: 'database_lookup',
        input: { task: 't' },
        details: { status: 'completed' },
        activeVerb: 'Delegating',
      }),
    ) as ToolCallItem
    expect(item).toMatchObject({
      type: 'tool_call',
      name: 'database_lookup',
      output: { status: 'completed' },
      activeVerb: 'Delegating',
    })
  })

  test('persists a provider-neutral UI navigation action as generic tool output', () => {
    const action = {
      type: 'ui.navigate' as const,
      uri: 'localix://ui/settings/tools/tool-loops',
      label: 'Open loops settings',
    }
    const item = buildToolItem(
      spec({
        name: 'localix_ui',
        input: action,
        details: action,
        activeVerb: 'Offering destination',
      }),
    ) as ToolCallItem

    expect(item).toMatchObject({
      type: 'tool_call',
      name: 'localix_ui',
      output: action,
    })
  })

  test('persists one suggestion set as the tool output instead of separate result rows', () => {
    const suggestions = {
      type: 'ui.navigate.suggestions' as const,
      suggestions: [
        {
          type: 'ui.navigate' as const,
          uri: 'localix://ui/settings/plugins',
          label: 'Plugins',
        },
        {
          type: 'ui.navigate' as const,
          uri: 'localix://ui/settings/tools',
          label: 'Tools',
        },
      ],
    }
    const item = buildToolItem(
      spec({
        name: 'localix_ui',
        input: { action: 'find', query: 'plugin settings' },
        details: suggestions,
        activeVerb: 'Finding destination',
      }),
    ) as ToolCallItem

    expect(item).toMatchObject({
      type: 'tool_call',
      name: 'localix_ui',
      output: suggestions,
    })
    expect(item.output).toBe(suggestions)
  })

  test('persists provider-agnostic source provenance on every tool-backed item', () => {
    const sources = [
      {
        id: 'source-docs',
        kind: 'web',
        title: 'Primary docs',
        uri: 'https://example.com/docs',
        role: 'consulted' as const,
        status: 'available' as const,
      },
    ]
    const item = buildToolItem({
      toolCallId: 't-source',
      name: 'research',
      status: 'completed',
      activeVerb: 'Researching',
      sources,
    })

    expect(item.sources).toEqual(sources)
  })

  test('error is carried through and isError derivable from status', () => {
    const item = buildToolItem(
      spec({
        name: 'read',
        status: 'failed',
        errorText: 'ENOENT',
        error: {
          kind: 'execution',
          message: 'ENOENT',
          userMessage: 'not found',
          retryable: false,
          fatal: false,
        },
      }),
    )
    expect(item.status).toBe('failed')
    expect(item.errorText).toBe('ENOENT')
    expect(item.error?.userMessage).toBe('not found')
  })
})

import type { ToolBackedItem } from '@localixai/agent/agents'

describe('createItemAccumulator', () => {
  const verb = () => 'Running'

  test('orders narrative + tools by first appearance, upserts in place', () => {
    const acc = createItemAccumulator(verb)
    acc.reasoning(0, 'thinking')
    acc.text(0, 'let me run it')
    acc.startTool(0, 'c1', 'bash', { command: 'ls' })
    acc.text(0, 'let me run it') // upsert, no dup
    expect(acc.list().map((i) => i.type)).toEqual(['reasoning', 'text', 'command'])
  })

  test('an in-place upsert does not mutate an earlier list snapshot', () => {
    const acc = createItemAccumulator(verb)
    acc.text(0, 'first')
    const published = acc.list()

    acc.text(0, 'second')

    expect(published[0]).toMatchObject({ text: 'first' })
    expect(acc.list()[0]).toMatchObject({ text: 'second' })
  })

  test('appends narrative deltas independently per turn content part', () => {
    const acc = createItemAccumulator(verb)
    acc.appendText(0, 'Hel', 0, { model: 'm' })
    acc.appendText(0, 'lo', 0, { model: 'm', textSignature: 'sig' })
    acc.appendReasoning(0, 'why', 1, { model: 'm' })
    acc.appendText(0, '!', 2, { model: 'm' })

    expect(acc.list()).toMatchObject([
      { id: 'text-0', contentIndex: 0, text: 'Hello', textSignature: 'sig' },
      { id: 'reasoning-0', contentIndex: 1, text: 'why' },
      { id: 'text-0-2', contentIndex: 2, text: '!' },
    ])
  })

  test('tool lifecycle pending → running → completed never downgrades, accumulates result', () => {
    const acc = createItemAccumulator(verb)
    acc.streamTool(0, { id: 'c1', name: 'bash', arguments: { command: 'ls' } })
    expect(acc.list()[0].status).toBe('pending')
    acc.startTool(0, 'c1', 'bash', { command: 'ls' })
    acc.updateToolDetails('c1', 'bash', { command: 'ls', output: 'partial' })
    expect(acc.list()[0].status).toBe('running')
    acc.endTool('c1', 'bash', {
      status: 'completed',
      details: { command: 'ls', output: 'a\nb', exitCode: 0 },
      resultText: 'a\nb',
    })
    const item = acc.list()[0] as ToolBackedItem & {
      exitCode?: number
      output?: string
    }
    expect(item.status).toBe('completed')
    expect(item.exitCode).toBe(0)
    expect(item.resultText).toBe('a\nb')
  })

  test('projects descriptor-owned standalone metadata without knowing the tool name', () => {
    const acc = createItemAccumulator(verb, {
      standaloneFor: (name) => name === 'extension_surface',
    })
    acc.startTool(0, 'surface-call', 'extension_surface', {})

    expect(acc.list()[0]).toMatchObject({
      name: 'extension_surface',
      standalone: true,
    })
  })

  test('promotes descriptor-owned content presentation and projects live actions generically', () => {
    const acc = createItemAccumulator(verb, {
      presentationFor: () => ({ transcript: 'content' }),
      actionsFor: (toolCallId) => [
        {
          toolCallId,
          action: 'pause',
          label: 'Pause feed',
        },
      ],
    })
    acc.startTool(0, 'surface-call', 'extension_surface', {})

    expect(acc.list()[0]).toMatchObject({
      name: 'extension_surface',
      standalone: true,
      presentation: { transcript: 'content' },
      actions: [
        {
          toolCallId: 'surface-call',
          action: 'pause',
        },
      ],
    })
  })

  /**
   * `list()` is the ownership boundary, and the sorted order behind it is now cached
   * (only a structural change — insert, reconcile-removal, reset — invalidates it).
   * Both halves of that need pinning: the cache must not start handing out a SHARED
   * array, because `run/event-handlers-flush.ts` decides delta-vs-snapshot by diffing
   * the previously published items array against the new one — share it and deltas
   * silently stop being emitted. And a late item with a lower contentIndex must still
   * sort into place, not append at the end.
   */
  test('list() returns a fresh array each call, and a late out-of-order item still sorts', () => {
    const acc = createItemAccumulator(verb)
    acc.text(0, 'second', 1)
    const a = acc.list()
    const b = acc.list()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)

    // A per-delta in-place replace must not reorder, and must not reuse a published array.
    acc.text(0, 'second (grown)', 1)
    const c = acc.list()
    expect(c).not.toBe(a)
    expect(c.map((i) => (i as { text?: string }).text)).toEqual(['second (grown)'])

    // Structural change: an item that belongs BEFORE the existing one arrives late.
    acc.reasoning(0, 'first', 0)
    expect(acc.list().map((i) => (i as { text?: string }).text)).toEqual([
      'first',
      'second (grown)',
    ])
  })

  test('reconcile drops stale pending tool items not in final ids', () => {
    const acc = createItemAccumulator(verb)
    acc.streamTool(0, { id: 'stale', name: 'edit' })
    acc.streamTool(0, { id: 'real', name: 'edit' })
    acc.startTool(0, 'real', 'edit', {})
    acc.reconcile(new Set(['real']))
    expect(acc.list().map((i) => (i as ToolBackedItem).toolCallId)).toEqual(['real'])
  })
})
