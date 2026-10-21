import { describe, expect, test } from 'bun:test'
import type { AgentItem, AgentSource } from '@localixai/agent/agents'

import { collectMessageSources } from './MessageSources'

const source = (overrides: Partial<AgentSource>): AgentSource => ({
  id: 's1',
  kind: 'web',
  title: 'Source',
  uri: 'https://example.com/source',
  role: 'consulted',
  status: 'available',
  ...overrides,
})

const toolItem = (id: string, sources: AgentSource[]): AgentItem =>
  ({
    id,
    type: 'tool_call',
    toolCallId: id,
    name: 'plugin_tool',
    activeVerb: 'Working',
    status: 'completed',
    sources,
  }) as AgentItem

describe('collectMessageSources', () => {
  test('keeps only resources that actually informed context', () => {
    expect(
      collectMessageSources([
        toolItem('one', [
          source({ id: 'used' }),
          source({
            id: 'found',
            uri: 'https://example.com/found',
            role: 'discovered',
          }),
          source({
            id: 'failed',
            uri: 'https://example.com/failed',
            role: 'consulted',
            status: 'failed',
          }),
        ]),
      ]).map((item) => item.id),
    ).toEqual(['used'])
  })

  test('deduplicates across tools and upgrades an explicit citation', () => {
    const result = collectMessageSources([
      toolItem('one', [source({ id: 'consulted', snippet: 'short' })]),
      toolItem('two', [
        source({
          id: 'citation',
          role: 'cited',
          title: 'Longer canonical source title',
          snippet: 'A longer source summary from the provider.',
        }),
      ]),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      // The id stays the FIRST admitted record's, even though the second wins the role.
      // Identity is a dedupe field, not a preference: dedupe keys on `kind\0uri` (equal here by
      // definition), so letting the id flip would only change the row's React key and remount it
      // mid-merge. This is the shared reconciler's rule; the UI's former private copy took the
      // id from the winner instead, which is the drift removing that copy closes.
      id: 'consulted',
      role: 'cited',
      title: 'Longer canonical source title',
      snippet: 'A longer source summary from the provider.',
    })
  })

  test('ignores narrative items and preserves first-use order', () => {
    const result = collectMessageSources([
      { id: 'text', type: 'text', status: 'completed', text: 'answer' },
      toolItem('one', [
        source({ id: 'a', uri: 'https://a.example/' }),
        source({ id: 'b', uri: 'https://b.example/' }),
      ]),
    ])
    expect(result.map((item) => item.id)).toEqual(['a', 'b'])
  })
})
