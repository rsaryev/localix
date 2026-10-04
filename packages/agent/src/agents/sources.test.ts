import { describe, expect, test } from 'bun:test'
import { normalizeAgentSources } from './sources'

describe('normalizeAgentSources', () => {
  test('bounds, defaults and reconciles duplicate third-party source records', () => {
    const sources = normalizeAgentSources([
      {
        kind: 'web',
        title: '  Primary docs  ',
        uri: 'https://example.com/docs',
        role: 'consulted',
        status: 'available',
        provider: 'brave',
        snippet: 'Evidence',
        metadata: { rank: 1, official: true, ignored: { nested: true } },
      },
      {
        kind: 'web',
        title: 'duplicate',
        uri: 'https://example.com/docs',
        role: 'cited',
        status: 'available',
      },
      { title: 'missing uri' },
    ])

    expect(sources).toEqual([
      {
        id: 'source-5c8888db',
        kind: 'web',
        title: 'Primary docs',
        uri: 'https://example.com/docs',
        role: 'cited',
        status: 'available',
        provider: 'brave',
        snippet: 'Evidence',
        metadata: { rank: 1, official: true },
      },
    ])
  })

  test('upgrades a discovered link when the same resource is later consulted', () => {
    expect(
      normalizeAgentSources([
        {
          id: 'link',
          kind: 'resource',
          title: 'Guide',
          uri: 'localix://resource/fixture-doc/guide',
          role: 'discovered',
          status: 'available',
        },
        {
          id: 'embedded',
          kind: 'resource',
          title: 'Current guide',
          uri: 'localix://resource/fixture-doc/guide',
          role: 'consulted',
          status: 'available',
          snippet: 'Loaded evidence',
        },
      ]),
    ).toEqual([
      {
        id: 'link',
        kind: 'resource',
        title: 'Current guide',
        uri: 'localix://resource/fixture-doc/guide',
        role: 'consulted',
        status: 'available',
        snippet: 'Loaded evidence',
      },
    ])
  })

  test('uses conservative relation/status defaults and enforces the caller cap', () => {
    const sources = normalizeAgentSources(
      [
        {
          id: 'a',
          uri: 'localix://resource/plugin/a',
          title: '',
          role: 'made-up',
          status: 'made-up',
        },
        {
          id: 'b',
          uri: 'localix://resource/plugin/b',
          role: 'cited',
          status: 'failed',
        },
      ],
      1,
    )

    expect(sources).toEqual([
      {
        id: 'a',
        kind: 'resource',
        title: 'localix://resource/plugin/a',
        uri: 'localix://resource/plugin/a',
        role: 'discovered',
        status: 'available',
      },
    ])
  })
})
