import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildUiLocationUri,
  normalizeUiAgentLocationCatalogSnapshot,
  type UiLocationContribution,
} from '@localixai/mini-app-sdk/ui'

import { setEnabledMiniAppNames } from './miniAppActivation'
import { createUiLocationRegistry, type UiLocationRegistry } from './uiLocations'

/**
 * THE CATALOG ROUND TRIP: what the registry publishes for the agent is exactly what the
 * backend accepts, and every destination the backend can build a URI for resolves back to a
 * live location in the registry that published it.
 *
 * Three layers each had their own tests (registry, SDK normalizer, tool) and nothing joined
 * them: a projection that dropped a field, or a normalizer that tightened a rule, would have
 * left the agent with a catalog the UI could not open — and the only witness would have been
 * a disabled button in a transcript.
 */
const workItem = (title: string) => ({
  kind: 'work-item' as const,
  workKind: 'round-trip-fixture',
  id: `fixture:${title}`,
  title,
})

function contribution(
  id: string,
  overrides: Partial<UiLocationContribution> = {},
): UiLocationContribution {
  return {
    id,
    uri: `localix://ui/work-item/${id}`,
    title: id,
    description: `${id} destination`,
    effect: 'read',
    surface: 'work-item',
    exposure: { search: true },
    keywords: [`${id}-alias`],
    agent: { description: `Open the ${id} destination.` },
    params: {},
    resolve: () => workItem(id),
    ...overrides,
  }
}

function snapshotOf(registry: UiLocationRegistry) {
  return {
    version: 1 as const,
    revision: registry.revision(),
    locations: registry.list({ exposure: 'agent' }).map((location) => ({
      uri: location.uri,
      title: location.title,
      description: location.agent!.description,
      aliases: location.keywords,
      ...(location.group ? { group: location.group } : {}),
      surface: location.surface as Exclude<typeof location.surface, 'action'>,
      params: location.params,
    })),
  }
}

afterEach(() => setEnabledMiniAppNames(null))

describe('agent catalog round trip', () => {
  test('every published agent location normalizes, builds a URI, and resolves back', () => {
    const registry = createUiLocationRegistry()
    expect(registry.register(contribution('terminal', { group: 'Workspace' }))).toBe(true)
    expect(
      registry.register(
        contribution('file', {
          params: { path: { type: 'string', description: 'Workspace-relative path.' } },
        }),
      ),
    ).toBe(true)
    // Not for the agent: no `agent` metadata, so it must not reach the snapshot at all.
    expect(registry.register(contribution('secret', { agent: undefined }))).toBe(true)

    const normalized = normalizeUiAgentLocationCatalogSnapshot(snapshotOf(registry))
    expect(normalized).not.toBeNull()
    expect(normalized!.locations.map((l) => l.uri)).toEqual([
      'localix://ui/work-item/file',
      'localix://ui/work-item/terminal',
    ])
    expect(normalized!.locations[1]?.group).toBe('Workspace')

    for (const location of normalized!.locations) {
      // Minimal valid args: every required string param gets a value.
      const args = Object.fromEntries(
        Object.entries(location.params)
          .filter(([, definition]) => !definition.optional && definition.type === 'string')
          .map(([key]) => [key, 'src/index.ts']),
      )
      const uri = buildUiLocationUri(location, args)
      expect(uri, location.uri).not.toBeNull()
      const resolved = registry.resolve(uri!)
      expect(resolved, uri!).not.toBeNull()
      expect(resolved?.descriptor.uri).toBe(location.uri)
    }
  })

  test('a projection that drops a required field is caught here, not in a transcript', () => {
    const registry = createUiLocationRegistry()
    expect(registry.register(contribution('terminal'))).toBe(true)
    const snapshot = snapshotOf(registry)
    const broken = {
      ...snapshot,
      locations: snapshot.locations.map(({ description: _drop, ...rest }) => rest),
    }
    expect(normalizeUiAgentLocationCatalogSnapshot(broken)).toBeNull()
  })
})
