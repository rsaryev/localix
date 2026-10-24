import { describe, expect, test } from 'bun:test'

import { DEFAULT_SOURCES, TRUST_WEIGHTS, defaultSource } from './default-sources'

describe('default sources', () => {
  test('a fresh profile starts with Localix, the official and the community marketplaces', () => {
    expect(
      DEFAULT_SOURCES.map(({ id, kind, trust, weight, editorial }) => ({
        id,
        kind,
        trust,
        weight,
        editorial,
      })),
    ).toEqual([
      { id: 'localix-mini-apps', kind: 'mini-app', trust: 'localix', weight: 1, editorial: true },
      { id: 'localix', kind: 'plugin', trust: 'localix', weight: 1, editorial: true },
      {
        id: 'claude-plugins-official',
        kind: 'plugin',
        trust: 'official',
        weight: 0.7,
        editorial: true,
      },
      {
        id: 'claude-plugins-community',
        kind: 'plugin',
        trust: 'community',
        weight: 0.35,
        editorial: false,
      },
    ])
  })

  test('each says what its provider adds', () => {
    expect(defaultSource('claude-plugins-official')?.input).toBe(
      'anthropics/claude-plugins-official',
    )
    expect(defaultSource('localix')?.paths).toEqual(['.claude-plugin', 'plugins'])
    expect(defaultSource('nope')).toBeUndefined()
  })

  test('a trust has its default weight', () => {
    expect(TRUST_WEIGHTS).toEqual({ localix: 1, official: 0.7, community: 0.35 })
  })
})
