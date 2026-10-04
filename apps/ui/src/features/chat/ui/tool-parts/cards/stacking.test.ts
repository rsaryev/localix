import { describe, expect, test } from 'bun:test'
import type { AgentItem } from '@localixai/agent/agents'

import {
  groupConsecutiveItems,
  isCollapsedGroup,
  READ_ONLY_MIN_COUNT,
  STACK_MIN_COUNT,
} from './stacking'

// read/search = read-only + stackable, write = stackable only,
// bash = neither (per cards/meta.ts).
const tool = (name: string, id: string, status = 'completed'): AgentItem =>
  ({ type: 'tool_call', name, id, status, input: {} }) as unknown as AgentItem
const text = (id: string): AgentItem => ({ type: 'text', id, text: 'hi' }) as unknown as AgentItem

const shape = (items: AgentItem[]) =>
  groupConsecutiveItems(items).map((g) => ({
    name: g.toolName,
    n: g.items.length,
    stackable: g.stackable,
  }))

const fold = (items: AgentItem[]) =>
  groupConsecutiveItems(items).map((g) => ({
    n: g.items.length,
    readOnly: g.readOnly,
    collapsed: isCollapsedGroup(g),
  }))

describe('groupConsecutiveItems', () => {
  test('empty / narrative-only input → no groups', () => {
    expect(groupConsecutiveItems([])).toEqual([])
    expect(groupConsecutiveItems([text('t1'), text('t2')])).toEqual([])
  })

  test('a run of the same stackable tool merges into one group', () => {
    expect(shape([tool('read', 'a'), tool('read', 'b'), tool('read', 'c')])).toEqual([
      { name: 'read', n: 3, stackable: true },
    ])
  })

  test('a non-stackable tool never merges, even in a run', () => {
    expect(shape([tool('bash', 'a'), tool('bash', 'b')])).toEqual([
      { name: 'bash', n: 1, stackable: false },
      { name: 'bash', n: 1, stackable: false },
    ])
  })

  test('different tool names form separate groups', () => {
    expect(shape([tool('read', 'a'), tool('apply_patch', 'b')])).toEqual([
      { name: 'read', n: 1, stackable: true },
      { name: 'apply_patch', n: 1, stackable: true },
    ])
  })

  test('a break in the run starts a new group (no cross-gap merge)', () => {
    expect(
      shape([tool('read', 'a'), tool('read', 'b'), tool('apply_patch', 'c'), tool('read', 'd')]),
    ).toEqual([
      { name: 'read', n: 2, stackable: true },
      { name: 'apply_patch', n: 1, stackable: true },
      { name: 'read', n: 1, stackable: true },
    ])
  })

  test('narrative items between tools are dropped, not treated as a break', () => {
    // text is filtered out entirely, so the two reads remain consecutive → one group.
    expect(shape([tool('read', 'a'), text('t'), tool('read', 'b')])).toEqual([
      { name: 'read', n: 2, stackable: true },
    ])
  })
})

describe('read-only folding', () => {
  test('2+ consecutive completed read-only calls of MIXED tools merge into one collapsed group', () => {
    expect(fold([tool('read', 'a'), tool('search', 'b'), tool('read', 'c')])).toEqual([
      { n: 3, readOnly: true, collapsed: true },
    ])
  })

  // Both fold at 2: one card becoming a one-line summary keeps the height, where folding at 3
  // showed two cards and then swapped them for one row.
  test('read-only and same-name runs both fold at 2', () => {
    expect(READ_ONLY_MIN_COUNT).toBe(2)
    expect(STACK_MIN_COUNT).toBe(2)
    expect(fold([tool('read', 'a'), tool('search', 'b')])).toEqual([
      { n: 2, readOnly: true, collapsed: true },
    ])
  })

  test('a single read-only item is never collapsed', () => {
    expect(fold([tool('read', 'a')])).toEqual([{ n: 1, readOnly: true, collapsed: false }])
  })

  // A running call used to stand alone and be absorbed on completion — a row in, a row out,
  // per call. It joins its group while it runs; the group's summary carries the live state.
  test('a running item joins its group instead of standing apart until it completes', () => {
    expect(
      fold([
        tool('read', 'a'),
        tool('search', 'b'),
        tool('read', 'c', 'running'),
        tool('read', 'd'),
      ]),
    ).toEqual([{ n: 4, readOnly: true, collapsed: true }])
    expect(fold([tool('write', 'a'), tool('write', 'b', 'running')])).toEqual([
      { n: 2, readOnly: false, collapsed: true },
    ])
  })

  test('the group a running call joins has the same shape once it completes', () => {
    const running = [tool('read', 'a'), tool('read', 'b', 'running')]
    const finished = [tool('read', 'a'), tool('read', 'b')]
    expect(fold(running)).toEqual(fold(finished))
  })

  test('a failed item breaks the group and stays visible as its own card', () => {
    expect(
      fold([tool('read', 'a'), tool('read', 'b', 'failed'), tool('read', 'c'), tool('read', 'd')]),
    ).toEqual([
      { n: 1, readOnly: true, collapsed: false },
      { n: 1, readOnly: false, collapsed: false },
      { n: 2, readOnly: true, collapsed: true },
    ])
  })

  test('non-completed read-only calls never merge with each other either', () => {
    expect(fold([tool('read', 'a', 'failed'), tool('read', 'b', 'failed')])).toEqual([
      { n: 1, readOnly: false, collapsed: false },
      { n: 1, readOnly: false, collapsed: false },
    ])
  })

  test('a mutating tool breaks a read-only run', () => {
    expect(
      fold([tool('read', 'a'), tool('search', 'b'), tool('write', 'c'), tool('read', 'd')]),
    ).toEqual([
      { n: 2, readOnly: true, collapsed: true },
      { n: 1, readOnly: false, collapsed: false },
      { n: 1, readOnly: true, collapsed: false },
    ])
  })

  test('same-name stackable tools (write) collapse at STACK_MIN_COUNT', () => {
    expect(fold([tool('write', 'a')])).toEqual([{ n: 1, readOnly: false, collapsed: false }])
    expect(fold([tool('write', 'a'), tool('write', 'b')])).toEqual([
      { n: 2, readOnly: false, collapsed: true },
    ])
  })
})
