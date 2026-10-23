import { describe, expect, test } from 'bun:test'
import { UI_AGENT_LOCATION_CATALOG_VERSION } from '@localixai/mini-app-sdk/ui'
import { createUiLocationCatalogService } from './service'

const terminal = {
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

const settings = {
  uri: 'localix://ui/settings/tools',
  title: 'Tools',
  description: 'Open tool settings.',
  surface: 'settings',
  params: {},
}

const catalog = (revision: number, locations: unknown[] = [terminal, settings]) => ({
  version: UI_AGENT_LOCATION_CATALOG_VERSION,
  revision,
  locations,
})

function evictOneSnapshot(service: ReturnType<typeof createUiLocationCatalogService>): void {
  // Fill the 256-entry payload cache through only 16 scopes and 16 publishers
  // per scope. That preserves an unrelated scope's publisher ordering state,
  // isolating payload eviction from publisher-scope eviction.
  for (let index = 1; index <= 256; index += 1) {
    expect(
      service.publish({
        userId: 'u1',
        projectId: `cache-project-${Math.ceil(index / 16)}`,
        publisherId: `page-${(index - 1) % 16}`,
        catalog: catalog(1, [
          {
            ...settings,
            uri: `localix://ui/settings/cache-destination-${index}`,
            title: `Cache destination ${index}`,
          },
        ]),
      }).status,
    ).toBe('accepted')
  }
}

describe('UI location catalog service', () => {
  test('content-addresses normalized catalogs independently of order and revision', () => {
    const service = createUiLocationCatalogService()
    const first = service.publish({
      userId: 'u1',
      projectId: 'p1',
      publisherId: 'page-a',
      catalog: catalog(1, [terminal, settings]),
    })
    const second = service.publish({
      userId: 'u1',
      projectId: 'p1',
      publisherId: 'page-a',
      catalog: catalog(2, [settings, terminal]),
    })

    expect(first.status).toBe('accepted')
    expect(second.status).toBe('accepted')
    if (first.status === 'accepted' && second.status === 'accepted') {
      expect(second.catalogId).toBe(first.catalogId)
      expect(service.get('u1', 'p1', second.catalogId)?.locations).toHaveLength(2)
    }
  })

  test('orders revisions only within one publisher generation', () => {
    const service = createUiLocationCatalogService()
    const first = service.publish({
      userId: 'u1',
      projectId: null,
      publisherId: 'old-page',
      catalog: catalog(12),
    })
    const reloaded = service.publish({
      userId: 'u1',
      projectId: null,
      publisherId: 'new-page',
      catalog: catalog(1),
    })
    const stale = service.publish({
      userId: 'u1',
      projectId: null,
      publisherId: 'old-page',
      catalog: catalog(11),
    })

    expect(first.status).toBe('accepted')
    expect(reloaded.status).toBe('accepted')
    expect(stale.status).toBe('stale')
  })

  test('rejects same-revision conflicts and invalid catalogs atomically', () => {
    const service = createUiLocationCatalogService()
    expect(
      service.publish({
        userId: 'u1',
        projectId: 'p1',
        publisherId: 'page',
        catalog: catalog(1),
      }).status,
    ).toBe('accepted')
    expect(
      service.publish({
        userId: 'u1',
        projectId: 'p1',
        publisherId: 'page',
        catalog: catalog(1, [terminal]),
      }).status,
    ).toBe('conflict')
    expect(
      service.publish({
        userId: 'u1',
        projectId: 'p1',
        publisherId: 'other',
        catalog: catalog(1, [{ ...terminal, surface: 'action' }]),
      }).status,
    ).toBe('invalid')
  })

  test('isolates immutable ids by authenticated user and project scope', () => {
    const service = createUiLocationCatalogService()
    const result = service.publish({
      userId: 'u1',
      projectId: 'p1',
      publisherId: 'page',
      catalog: catalog(1),
    })
    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    expect(service.get('u1', 'p1', result.catalogId)).not.toBeNull()
    expect(service.get('u1', 'p2', result.catalogId)).toBeNull()
    expect(service.get('u2', 'p1', result.catalogId)).toBeNull()
  })

  test('rehydrates an unchanged publisher after its globally cached payload was evicted', () => {
    const service = createUiLocationCatalogService()
    const first = service.publish({
      userId: 'u1',
      projectId: 'project-0',
      publisherId: 'page',
      catalog: catalog(1),
    })
    expect(first.status).toBe('accepted')
    if (first.status !== 'accepted') return

    evictOneSnapshot(service)
    expect(service.get('u1', 'project-0', first.catalogId)).toBeNull()

    const repeated = service.publish({
      userId: 'u1',
      projectId: 'project-0',
      publisherId: 'page',
      catalog: catalog(1),
    })
    expect(repeated).toEqual({ status: 'unchanged', catalogId: first.catalogId })
    expect(service.get('u1', 'project-0', first.catalogId)?.locations).toHaveLength(2)
  })

  test('never returns a stale publisher id after its payload was evicted', () => {
    const service = createUiLocationCatalogService()
    const latest = service.publish({
      userId: 'u1',
      projectId: 'project-0',
      publisherId: 'page',
      catalog: catalog(2),
    })
    expect(latest.status).toBe('accepted')
    if (latest.status !== 'accepted') return

    evictOneSnapshot(service)
    expect(service.get('u1', 'project-0', latest.catalogId)).toBeNull()

    const older = service.publish({
      userId: 'u1',
      projectId: 'project-0',
      publisherId: 'page',
      catalog: catalog(1, [terminal]),
    })
    expect(older.status).toBe('accepted')
    if (older.status !== 'accepted') return
    expect(service.get('u1', 'project-0', older.catalogId)?.locations).toHaveLength(1)
  })

  test('bounds publisher revision state across inactive user and project scopes', () => {
    const service = createUiLocationCatalogService()
    expect(
      service.publish({
        userId: 'u1',
        projectId: 'project-0',
        publisherId: 'page',
        catalog: catalog(1, [terminal]),
      }).status,
    ).toBe('accepted')

    for (let index = 1; index <= 256; index += 1) {
      expect(
        service.publish({
          userId: 'u1',
          projectId: `project-${index}`,
          publisherId: 'page',
          catalog: catalog(1, [
            {
              ...settings,
              uri: `localix://ui/settings/destination-${index}`,
              title: `Destination ${index}`,
            },
          ]),
        }).status,
      ).toBe('accepted')
    }

    // The oldest scope's same revision may now establish a fresh generation
    // instead of conflicting forever with otherwise unreachable publisher state.
    expect(
      service.publish({
        userId: 'u1',
        projectId: 'project-0',
        publisherId: 'page',
        catalog: catalog(1, [settings]),
      }).status,
    ).toBe('accepted')
  })
})
