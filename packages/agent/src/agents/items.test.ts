import { describe, expect, test } from 'bun:test'

import {
  applyItemEvent,
  applyTurnEvent,
  emptyTurn,
  isToolBackedItem,
  isNarrativeItem,
  isItemStreaming,
  hasItemError,
  isTextItem,
  isReasoningItem,
  isCommandItem,
  isFileChangeItem,
  isMcpCallItem,
  isToolCallItem,
  type AgentItem,
  type CommandItem,
  type TextItem,
} from './items'

describe('item type guards', () => {
  const GUARDS: Array<[string, (i: AgentItem) => boolean]> = [
    ['text', isTextItem],
    ['reasoning', isReasoningItem],
    ['command', isCommandItem],
    ['file_change', isFileChangeItem],
    ['mcp_call', isMcpCallItem],
    ['tool_call', isToolCallItem],
  ]

  for (const [type, guard] of GUARDS) {
    test(`matches only "${type}" items`, () => {
      for (const [other] of GUARDS) {
        const item = { type: other, status: 'completed' } as unknown as AgentItem
        expect(guard(item)).toBe(other === type)
      }
    })
  }
})

describe('item predicates', () => {
  const it = (type: string, status = 'completed'): AgentItem =>
    ({ type, status }) as unknown as AgentItem

  test('isNarrativeItem: text/reasoning only', () => {
    expect(isNarrativeItem(it('text'))).toBe(true)
    expect(isNarrativeItem(it('reasoning'))).toBe(true)
    expect(isNarrativeItem(it('tool_call'))).toBe(false)
  })

  test('isItemStreaming: pending or running', () => {
    expect(isItemStreaming(it('text', 'pending'))).toBe(true)
    expect(isItemStreaming(it('text', 'running'))).toBe(true)
    expect(isItemStreaming(it('text', 'completed'))).toBe(false)
    expect(isItemStreaming(it('text', 'failed'))).toBe(false)
  })

  test('hasItemError: failed only', () => {
    expect(hasItemError(it('text', 'failed'))).toBe(true)
    expect(hasItemError(it('text', 'completed'))).toBe(false)
    expect(hasItemError(it('text', 'aborted'))).toBe(false)
  })
})

const cmd = (id: string, over: Partial<CommandItem> = {}): CommandItem => ({
  id,
  type: 'command',
  status: 'running',
  toolCallId: id,
  name: 'bash',
  command: 'ls',
  ...over,
})

describe('isToolBackedItem', () => {
  test('distinguishes tool-backed from narrative items', () => {
    expect(isToolBackedItem(cmd('c'))).toBe(true)
    expect(isToolBackedItem({ id: 't', type: 'text', status: 'running', text: '' })).toBe(false)
  })
})

describe('applyItemEvent', () => {
  const text = (id: string, t = ''): TextItem => ({ id, type: 'text', status: 'running', text: t })

  test('started appends, then completed replaces by id (order preserved)', () => {
    let items: AgentItem[] = []
    items = applyItemEvent(items, { kind: 'item.started', item: text('a') })
    items = applyItemEvent(items, {
      kind: 'item.started',
      item: { id: 'b', type: 'reasoning', status: 'running', text: '' },
    })
    expect(items.map((i) => i.id)).toEqual(['a', 'b'])
    items = applyItemEvent(items, {
      kind: 'item.completed',
      item: { ...text('a', 'done'), status: 'completed' },
    })
    expect(items[0]).toMatchObject({ id: 'a', status: 'completed', text: 'done' })
    expect(items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  test('text delta appends to text items; output delta to command items', () => {
    let items: AgentItem[] = [text('a')]
    items = applyItemEvent(items, { kind: 'item.delta', itemId: 'a', delta: 'Hel' })
    items = applyItemEvent(items, { kind: 'item.delta', itemId: 'a', field: 'text', delta: 'lo' })
    expect((items[0] as TextItem).text).toBe('Hello')

    let cmds: AgentItem[] = [cmd('c')]
    cmds = applyItemEvent(cmds, {
      kind: 'item.delta',
      itemId: 'c',
      field: 'output',
      delta: 'file1\n',
    })
    expect((cmds[0] as CommandItem).output).toBe('file1\n')
    // text-field delta on a command is a no-op (wrong field)
    cmds = applyItemEvent(cmds, { kind: 'item.delta', itemId: 'c', field: 'text', delta: 'x' })
    expect((cmds[0] as CommandItem).output).toBe('file1\n')
  })

  test('delta/updated for an unknown id is a no-op (no throw)', () => {
    const items: AgentItem[] = [text('a')]
    expect(applyItemEvent(items, { kind: 'item.delta', itemId: 'zzz', delta: 'x' })).toBe(items)
    expect(
      applyItemEvent(items, { kind: 'item.updated', itemId: 'zzz', patch: { status: 'failed' } }),
    ).toBe(items)
  })

  test('updated patches status/metadata without changing type', () => {
    let items: AgentItem[] = [cmd('c')]
    items = applyItemEvent(items, {
      kind: 'item.updated',
      itemId: 'c',
      patch: { status: 'completed', exitCode: 0, durationMs: 12 } as Partial<CommandItem>,
    })
    expect(items[0]).toMatchObject({
      type: 'command',
      status: 'completed',
      exitCode: 0,
      durationMs: 12,
    })
  })
})

describe('applyTurnEvent', () => {
  test('turn.started sets the turn id + running status, preserving accumulated items', () => {
    const seeded = {
      ...emptyTurn('old'),
      status: 'completed' as const,
      items: [{ type: 'text', text: 'hi', status: 'completed' }] as never,
    }
    const started = applyTurnEvent(seeded, { kind: 'turn.started', turnId: 'T1' })
    expect(started.id).toBe('T1')
    expect(started.status).toBe('running')
    expect(started.items).toBe(seeded.items) // spread-preserved
  })

  test('folds the turn lifecycle and maps stop reason to status', () => {
    let turn = emptyTurn('t1')
    expect(turn.status).toBe('running')
    turn = applyTurnEvent(turn, {
      kind: 'turn.updated',
      turnId: 't1',
      usage: { outputTokens: 5 },
      aggregatedDiff: 'diff',
    })
    expect(turn.usage?.outputTokens).toBe(5)
    expect(turn.aggregatedDiff).toBe('diff')

    const completed = applyTurnEvent(turn, {
      kind: 'turn.completed',
      turnId: 't1',
      stopReason: 'complete',
    })
    expect(completed.status).toBe('completed')

    const errored = applyTurnEvent(turn, {
      kind: 'turn.completed',
      turnId: 't1',
      stopReason: 'error',
    })
    expect(errored.status).toBe('failed')

    const stopped = applyTurnEvent(turn, {
      kind: 'turn.completed',
      turnId: 't1',
      stopReason: 'user_stopped',
    })
    expect(stopped.status).toBe('aborted')
  })
})
