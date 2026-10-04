import { describe, expect, test } from 'bun:test'
import type { AgentItem, AgentSource } from '@localixai/agent/agents'

import {
  answerSources,
  collectSessionSources,
  sourceKindGroups,
  type SourceBearingMessage,
} from './sessionSources'

const source = (over: Partial<AgentSource> = {}): AgentSource => ({
  id: 'src',
  kind: 'web',
  title: 'A source',
  uri: 'https://example.com/a',
  role: 'consulted',
  status: 'available',
  ...over,
})

const message = (id: string, sources: AgentSource[][]): SourceBearingMessage => ({
  id,
  items: sources.map(
    (list, index) =>
      ({
        id: `${id}-tool-${index}`,
        type: 'tool_call',
        name: 'read',
        status: 'completed',
        sources: list,
      }) as unknown as AgentItem,
  ),
})

/**
 * Search-then-read is the commonest thing an agent does, and it used to produce two rows.
 *
 * `search` publishes `…/file?path=X&line=7`; `read` publishes `…/file?path=X`. Keyed on the raw
 * URI those never met, so `mergeSource`'s role upgrade never fired and the drawer kept showing a
 * file the agent had READ in the "found or failed" set, labelled as merely discovered.
 */
describe('a file found and then read', () => {
  const found = source({
    uri: 'localix://ui/work-item/file?path=src%2Fa.ts&line=7',
    kind: 'file',
    role: 'discovered',
  })
  const read = source({
    uri: 'localix://ui/work-item/file?path=src%2Fa.ts',
    kind: 'file',
    role: 'consulted',
  })

  test('is one row, upgraded to consulted', () => {
    const result = collectSessionSources([message('m1', [[found]]), message('m2', [[read]])])

    expect(result).toHaveLength(1)
    expect(result[0]?.role).toBe('consulted')
    expect(result[0]?.messageIds).toEqual(['m1', 'm2'])
  })

  test('and still opens at the line the search matched', () => {
    // `mergeSource` keeps the first-seen uri, which is the more specific place to land.
    const result = collectSessionSources([message('m1', [[found]]), message('m2', [[read]])])

    expect(result[0]?.uri).toContain('line=7')
  })

  test('two SYMBOLS in one file stay two rows — there the line is the identity', () => {
    const first = source({
      uri: 'localix://ui/work-item/file?path=src%2Fa.ts&line=7',
      kind: 'symbol',
    })
    const second = source({
      uri: 'localix://ui/work-item/file?path=src%2Fa.ts&line=90',
      kind: 'symbol',
    })

    expect(collectSessionSources([message('m1', [[first, second]])])).toHaveLength(2)
  })

  test('a document and a file at the same path stay two rows', () => {
    // The drawer groups by kind, so collapsing them would put one under a heading it does not
    // belong to.
    const asFile = source({ uri: 'localix://ui/work-item/file?path=src%2Fa.ts', kind: 'file' })
    const asDoc = source({ uri: 'localix://ui/work-item/file?path=src%2Fa.ts', kind: 'document' })

    expect(collectSessionSources([message('m1', [[asFile, asDoc]])])).toHaveLength(2)
  })
})

describe('collectSessionSources', () => {
  test('spans the whole conversation, not one answer', () => {
    const result = collectSessionSources([
      message('m1', [[source({ uri: 'file:///a', kind: 'file' })]]),
      message('m2', [[source({ uri: 'file:///b', kind: 'file' })]]),
    ])

    expect(result.map((s) => s.uri)).toEqual(['file:///a', 'file:///b'])
  })

  test('deduplicates across messages and records every place it came up', () => {
    const result = collectSessionSources([
      message('m1', [[source()]]),
      message('m2', [[source()]]),
      message('m3', [[source()]]),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.messageIds).toEqual(['m1', 'm2', 'm3'])
    expect(result[0]?.count).toBe(3)
  })

  test('one message is listed once however many of its items carried the source', () => {
    // The affordance is "jump to where this came up"; the same message twice is not a second
    // place. `count` still records both observations.
    const result = collectSessionSources([message('m1', [[source()], [source()]])])

    expect(result[0]?.messageIds).toEqual(['m1'])
    expect(result[0]?.count).toBe(2)
  })

  test('a later, stronger observation upgrades the row in place', () => {
    const result = collectSessionSources([
      message('m1', [[source({ role: 'consulted', title: 'short' })]]),
      message('m2', [[source({ role: 'cited', title: 'the longer canonical title' })]]),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ role: 'cited', title: 'the longer canonical title' })
    // …without moving it. Order is the trail of what happened.
    expect(result[0]?.messageIds[0]).toBe('m1')
  })

  test('order is first appearance, and stays put as new sources arrive', () => {
    const first = collectSessionSources([
      message('m1', [[source({ uri: 'file:///a', kind: 'file' })]]),
      message('m2', [[source({ uri: 'file:///b', kind: 'file' })]]),
    ])
    const later = collectSessionSources([
      message('m1', [[source({ uri: 'file:///a', kind: 'file' })]]),
      message('m2', [[source({ uri: 'file:///b', kind: 'file' })]]),
      // `a` seen again, plus a new one.
      message('m3', [
        [source({ uri: 'file:///a', kind: 'file' }), source({ uri: 'file:///c', kind: 'file' })],
      ]),
    ])

    expect(first.map((s) => s.uri)).toEqual(['file:///a', 'file:///b'])
    expect(later.map((s) => s.uri)).toEqual(['file:///a', 'file:///b', 'file:///c'])
  })

  test('the same URI under a different KIND is a different source', () => {
    // Dedupe keys on kind + uri: a symbol and the file it lives in share a URI and are not the
    // same row.
    const result = collectSessionSources([
      message('m1', [
        [
          source({ kind: 'file', uri: 'localix://ui/work-item/file?path=a.ts' }),
          source({ kind: 'symbol', uri: 'localix://ui/work-item/file?path=a.ts' }),
        ],
      ]),
    ])

    expect(result).toHaveLength(2)
  })

  test('keeps discovered and failed records — the registry is not the answer surface', () => {
    const result = collectSessionSources([
      message('m1', [
        [
          source({ uri: 'file:///read', kind: 'file' }),
          source({ uri: 'file:///found', kind: 'file', role: 'discovered' }),
          source({ uri: 'file:///gone', kind: 'file', status: 'failed' }),
        ],
      ]),
    ])

    expect(result).toHaveLength(3)
  })

  test('narrative items and empty input contribute nothing', () => {
    expect(collectSessionSources(undefined)).toEqual([])
    expect(collectSessionSources([{ id: 'm1' }])).toEqual([])
    expect(
      collectSessionSources([
        { id: 'm1', items: [{ id: 'x', type: 'text', text: 'hello' } as unknown as AgentItem] },
      ]),
    ).toEqual([])
  })
})

describe('answerSources', () => {
  test('excludes discovered and failed records', () => {
    // A change-gate requirement: a grep hit and a read that failed must never appear beneath an
    // answer as if they informed it.
    const all = collectSessionSources([
      message('m1', [
        [
          source({ uri: 'file:///read', kind: 'file' }),
          source({ uri: 'file:///found', kind: 'file', role: 'discovered' }),
          source({ uri: 'file:///gone', kind: 'file', status: 'failed' }),
          source({ uri: 'https://example.com/cited', role: 'cited' }),
        ],
      ]),
    ])

    expect(answerSources(all).map((s) => s.uri)).toEqual([
      'file:///read',
      'https://example.com/cited',
    ])
  })
})

describe('sourceKindGroups', () => {
  test('groups by kind, in the order each kind first appeared', () => {
    const groups = sourceKindGroups(
      collectSessionSources([
        message('m1', [
          [
            source({ kind: 'file', uri: 'file:///a' }),
            source({ kind: 'web', uri: 'https://example.com/1' }),
            source({ kind: 'file', uri: 'file:///b' }),
            source({ kind: 'session', uri: 'localix://ui/work-item/chat?session=X' }),
          ],
        ]),
      ]),
    )

    expect(groups.map((g) => g.kind)).toEqual(['file', 'web', 'session'])
    expect(groups[0]?.sources.map((s) => s.uri)).toEqual(['file:///a', 'file:///b'])
  })

  test('an empty registry produces no groups, not one empty group', () => {
    expect(sourceKindGroups([])).toEqual([])
  })
})
