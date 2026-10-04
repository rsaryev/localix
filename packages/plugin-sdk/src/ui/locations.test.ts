import { describe, expect, test } from 'bun:test'
import {
  UI_AGENT_LOCATION_CATALOG_VERSION,
  buildUiLocationUri,
  isValidUiLocationParamSchema,
  normalizeUiAgentLocationCatalogSnapshot,
  normalizeUiLocationBaseUri,
  parseUiLocationArgs,
  type UiAgentLocationDescriptor,
} from './locations'

const terminal: UiAgentLocationDescriptor = {
  uri: 'localix://ui/work-item/terminal',
  title: 'Terminal',
  description: 'Reveal or create a workspace terminal.',
  surface: 'work-item',
  params: {
    mode: {
      type: 'string',
      description: 'Whether to reuse or create a terminal.',
      optional: true,
      values: ['reuse', 'new'],
    },
  },
}

describe('shared UI location codec', () => {
  test('builds and parses one typed argument vocabulary', () => {
    const uri = buildUiLocationUri(terminal, { mode: 'new' })
    expect(uri).toBe('localix://ui/work-item/terminal?mode=new')
    expect(parseUiLocationArgs(terminal.params, new URL(uri!).searchParams)).toEqual({
      mode: 'new',
    })
    expect(buildUiLocationUri(terminal, { mode: 'invalid' })).toBeNull()
    expect(buildUiLocationUri(terminal, { unknown: true })).toBeNull()
  })

  test('rejects malformed schemas without JSON-corrupting numeric bounds', () => {
    for (const schema of [
      { value: { type: 'mystery' } },
      { value: { type: 'string', optional: 'yes' } },
      { value: { type: 'string', allowEmpty: 1 } },
      { value: { type: 'integer', minimum: -Infinity } },
      { value: { type: 'integer', maximum: 1.5 } },
      { value: null },
    ]) {
      expect(isValidUiLocationParamSchema(schema)).toBe(false)
    }
  })

  test('canonicalizes encoded aliases and rejects credentials or dot segments', () => {
    expect(normalizeUiLocationBaseUri('localix://ui/work-item/%74erminal', 'work-item')).toBe(
      'localix://ui/work-item/terminal',
    )
    expect(
      normalizeUiLocationBaseUri('localix://user@ui/work-item/terminal', 'work-item'),
    ).toBeNull()
    expect(
      normalizeUiLocationBaseUri('localix://ui/work-item/x/../terminal', 'work-item'),
    ).toBeNull()
    expect(
      normalizeUiLocationBaseUri('localix://ui/work-item/x/%2e%2e/terminal', 'work-item'),
    ).toBeNull()
  })

  test('normalizes a deterministic, read-only catalog atomically', () => {
    const settings = {
      uri: 'localix://ui/settings/tools',
      title: 'Tools',
      description: 'Open tool settings.',
      aliases: ['settings', 'tools', 'settings'],
      surface: 'settings',
      params: {},
    }
    const normalized = normalizeUiAgentLocationCatalogSnapshot({
      version: UI_AGENT_LOCATION_CATALOG_VERSION,
      revision: 7,
      locations: [terminal, settings],
    })
    expect(normalized?.locations.map((entry) => entry.uri)).toEqual([
      'localix://ui/settings/tools',
      'localix://ui/work-item/terminal',
    ])
    expect(normalized?.locations[0]?.aliases).toEqual(['settings', 'tools'])
    // `group` is optional, trimmed, bounded, and never a control-character carrier.
    const grouped = normalizeUiAgentLocationCatalogSnapshot({
      version: UI_AGENT_LOCATION_CATALOG_VERSION,
      revision: 7,
      locations: [{ ...settings, group: '  Settings ' }],
    })
    expect(grouped?.locations[0]?.group).toBe('Settings')
    expect('group' in (normalized?.locations[0] ?? {})).toBe(false)
    for (const group of ['', '   ', 'x'.repeat(81), 'a\u0007b', 7]) {
      expect(
        normalizeUiAgentLocationCatalogSnapshot({
          version: UI_AGENT_LOCATION_CATALOG_VERSION,
          revision: 7,
          locations: [{ ...settings, group }],
        }),
      ).toBeNull()
    }
    expect(
      normalizeUiAgentLocationCatalogSnapshot({
        version: UI_AGENT_LOCATION_CATALOG_VERSION,
        revision: 7,
        locations: [terminal, terminal],
      }),
    ).toBeNull()
    expect(
      normalizeUiAgentLocationCatalogSnapshot({
        version: UI_AGENT_LOCATION_CATALOG_VERSION,
        revision: 7,
        locations: [{ ...terminal, uri: 'localix://ui/action/state/reset', surface: 'action' }],
      }),
    ).toBeNull()
    expect(
      normalizeUiAgentLocationCatalogSnapshot({
        version: UI_AGENT_LOCATION_CATALOG_VERSION,
        revision: 7,
        locations: [
          { ...terminal, aliases: Array.from({ length: 25 }, (_, index) => `a${index}`) },
        ],
      }),
    ).toBeNull()
  })

  test('uses locale-independent code-point ordering for canonical wire content', () => {
    const normalized = normalizeUiAgentLocationCatalogSnapshot({
      version: UI_AGENT_LOCATION_CATALOG_VERSION,
      revision: 1,
      locations: [
        {
          ...terminal,
          uri: 'localix://ui/work-item/z',
          aliases: ['äther', 'zebra'],
        },
      ],
    })

    expect(normalized?.locations[0]?.aliases).toEqual(['zebra', 'äther'])
  })
})
