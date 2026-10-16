import { describe, expect, it } from 'bun:test'
import {
  buildResourceUri,
  createResourceProviderRegistry,
  flattenResourceBrowse,
  resourceBrowseFailureNotice,
  resourceDrillPartial,
  resourceParentPartial,
  type ResourceNode,
  type ResourceRefProvider,
} from './resource-refs'

const provider = (provider: string): ResourceRefProvider => ({
  provider,
  title: provider,
  listChildren: async () => [
    { uri: buildResourceUri(provider, ['root']), label: 'root', hasChildren: false },
  ],
  expand: async () => ({ ok: true, content: provider }),
})

describe('createResourceProviderRegistry unregister', () => {
  it('removes the provider from lookups, roots, and expansion', async () => {
    const registry = createResourceProviderRegistry()
    registry.register(provider('a'))
    registry.register(provider('b'))
    registry.unregister('a')
    expect(registry.get('a')).toBeUndefined()
    const roots = await registry.listChildren('u', null)
    expect(roots.map((n) => n.uri)).toEqual([buildResourceUri('b', ['root'])])
    const expansion = await registry.expand('u', buildResourceUri('a', ['root']))
    expect(expansion.ok).toBe(false)
  })

  it('is a no-op for unknown providers and allows re-registration', () => {
    const registry = createResourceProviderRegistry()
    registry.unregister('ghost')
    registry.register(provider('a'))
    registry.unregister('a')
    registry.register(provider('a'))
    expect(registry.get('a')).toBeDefined()
  })

  // A provider is a free string from the plugin, and CORE registers providers of its own at
  // boot (`git`), which nothing ever re-registers. So a collision is not symmetric: the
  // loser can be core.
  it('a colliding plugin cannot shadow the provider registered first', async () => {
    const registry = createResourceProviderRegistry()
    const core = provider('git')
    const impostor = {
      ...provider('git'),
      expand: async () => ({ ok: true as const, content: 'impostor' }),
    }
    expect(registry.register(core)).toBe(true)
    expect(registry.register(impostor)).toBe(false)

    expect(registry.get('git')).toBe(core)
    expect(await registry.expand('u', buildResourceUri('git', ['root']))).toEqual({
      ok: true,
      content: 'git',
    })
  })

  it("a plugin's disable cannot evict a provider it does not own", async () => {
    // THE BUG: unregister took a bare provider, so a losing plugin's teardown deleted
    // whatever sat under it — core's git provider included, permanently.
    const registry = createResourceProviderRegistry()
    const core = provider('git')
    const impostor = provider('git')
    registry.register(core)
    registry.register(impostor)

    registry.unregister(impostor)

    expect(registry.get('git')).toBe(core)
  })

  it('a provider IS removed by its own owner — the reverse direction', () => {
    // Without this the fix is a leak: disabled plugins keep answering @-refs forever.
    const registry = createResourceProviderRegistry()
    const own = provider('db')
    registry.register(own)
    registry.unregister(own)
    expect(registry.get('db')).toBeUndefined()
  })

  it('rejects non-canonical providers at the registration boundary', () => {
    const registry = createResourceProviderRegistry()
    expect(registry.register(provider('DB'))).toBe(false)
    expect(registry.register(provider('bad provider'))).toBe(false)
    expect(registry.list()).toEqual([])
  })
})

describe('backend-authoritative resource browsing', () => {
  const browseProvider = (
    provider: string,
    title: string,
    roots: Array<{ uri: string; label: string; detail?: string }>,
  ): ResourceRefProvider => ({
    provider,
    title,
    async listChildren(_userId, parent, query) {
      if (parent === null) {
        // Deliberately reverse provider order and optionally honor query. The
        // registry must still return one deterministic contract.
        return [...roots]
          .reverse()
          .filter(
            (node) =>
              !query ||
              `${node.label} ${node.detail ?? ''}`.toLowerCase().includes(query.toLowerCase()),
          )
          .map((node) => ({ ...node, hasChildren: true }))
      }
      return [
        { uri: `${parent}/z`, label: 'Zulu', hasChildren: false },
        { uri: `${parent}/a`, label: 'alpha 2', hasChildren: false },
        { uri: `${parent}/a10`, label: 'Alpha 10', hasChildren: false },
      ]
    },
    async expand() {
      return { ok: true, content: '' }
    },
  })

  it('lists sorted provider categories first without eagerly loading their resources', async () => {
    const registry = createResourceProviderRegistry()
    registry.register(
      browseProvider('git', 'Repositories', [
        { uri: buildResourceUri('git', ['work']), label: 'Workspace' },
      ]),
    )
    registry.register(
      browseProvider('db', 'Databases', [
        { uri: buildResourceUri('db', ['z']), label: 'Zulu' },
        { uri: buildResourceUri('db', ['a10']), label: 'alpha 10' },
        { uri: buildResourceUri('db', ['a2']), label: 'Alpha 2' },
      ]),
    )

    const result = await registry.browse('u', '')
    expect(result.groups.map((group) => group.label)).toEqual(['Databases', 'Repositories'])
    expect(flattenResourceBrowse(result)).toEqual([
      {
        uri: buildResourceUri('db'),
        label: 'Databases',
        hasChildren: true,
        icon: 'db',
        navigationOnly: true,
      },
      {
        uri: buildResourceUri('git'),
        label: 'Repositories',
        hasChildren: true,
        icon: 'git',
        navigationOnly: true,
      },
    ])
  })

  it('applies the shared response cap to the provider-group catalog too', async () => {
    const registry = createResourceProviderRegistry()
    for (let index = 0; index < 55; index += 1) {
      const providerId = `provider-${index.toString().padStart(2, '0')}`
      registry.register(provider(providerId))
    }

    const result = await registry.browse('u', '')
    expect(result.groups).toHaveLength(50)
    expect(result).toMatchObject({ total: 55, truncated: true })
    expect(result.notices).toContainEqual(
      expect.objectContaining({
        label: 'Showing 50 of 55 matching resource groups',
        notice: true,
      }),
    )
  })

  it('scopes a provider root to one provider, then drills and searches on the server', async () => {
    const registry = createResourceProviderRegistry()
    registry.register(
      browseProvider('git', 'Repositories', [
        { uri: buildResourceUri('git', ['g']), label: 'Git' },
      ]),
    )
    registry.register(
      browseProvider('db', 'Databases', [
        { uri: buildResourceUri('db', ['main']), label: 'Primary' },
      ]),
    )

    const providerRoots = await registry.browse('u', buildResourceUri('db'))
    expect(providerRoots.provider).toBe('db')
    expect(flattenResourceBrowse(providerRoots).map((node) => node.uri)).toEqual([
      buildResourceUri('db', ['main']),
    ])

    const drilled = await registry.browse('u', buildResourceUri('db', ['main', 'al']))
    expect(drilled).toMatchObject({
      parent: buildResourceUri('db', ['main']),
      provider: 'db',
      segment: 'al',
    })
    expect(flattenResourceBrowse(drilled).map((node) => node.label)).toEqual([
      'alpha 2',
      'Alpha 10',
    ])
  })

  it('treats a provider-scoped segment only as a resource query', async () => {
    const seen: Array<string | undefined> = []
    const registry = createResourceProviderRegistry()
    registry.register({
      ...provider('db'),
      title: 'Databases',
      async listChildren(_userId, _parent, query) {
        seen.push(query)
        return query === 'database'
          ? [
              {
                uri: buildResourceUri('db', ['matching']),
                label: 'Matching database',
                hasChildren: false,
              },
            ]
          : [{ uri: buildResourceUri('db', ['other']), label: 'Other', hasChildren: false }]
      },
    })

    const result = await registry.browse('u', buildResourceUri('db', ['database']))
    expect(seen).toEqual(['database'])
    expect(flattenResourceBrowse(result).map((node) => node.uri)).toEqual([
      buildResourceUri('db', ['matching']),
    ])
  })

  it('searches provider categories without loading or filtering provider resources', async () => {
    const seen: Array<string | undefined> = []
    const database = browseProvider('db', 'Databases', [
      { uri: buildResourceUri('db', ['main']), label: 'Primary' },
    ])
    const original = database.listChildren.bind(database)
    database.listChildren = async (userId, parent, query) => {
      seen.push(query)
      return original(userId, parent, query)
    }
    const registry = createResourceProviderRegistry()
    registry.register(database)
    const result = await registry.browse('u', 'database')
    expect(seen).toEqual([])
    expect(flattenResourceBrowse(result).map((node) => node.uri)).toEqual([buildResourceUri('db')])
  })

  it('shares category drill and one-level back navigation across clients', () => {
    expect(resourceDrillPartial(buildResourceUri('db'))).toBe(`${buildResourceUri('db')}/`)
    expect(resourceDrillPartial(buildResourceUri('db', ['main']))).toBe(
      `${buildResourceUri('db', ['main'])}/`,
    )
    expect(resourceParentPartial(buildResourceUri('db'))).toBe('')
    expect(resourceParentPartial(`${buildResourceUri('db', ['main'])}/`)).toBe(
      `${buildResourceUri('db')}/`,
    )
    expect(resourceParentPartial(`${buildResourceUri('db', ['main', 'public'])}/`)).toBe(
      `${buildResourceUri('db', ['main'])}/`,
    )
    expect(resourceParentPartial(buildResourceUri('db', ['main', 'pub']))).toBe(
      `${buildResourceUri('db', ['main'])}/`,
    )
  })

  it('shares a scoped, non-selectable transport-failure notice across clients', () => {
    expect(resourceBrowseFailureNotice(buildResourceUri('db', ['main', 'orders']))).toEqual({
      uri: `${buildResourceUri('db', ['main'])}#notice`,
      label: 'Resource browser unavailable',
      detail: 'Check the connection and try again',
      hasChildren: false,
      notice: true,
    })
    expect(resourceBrowseFailureNotice('')).toEqual(
      expect.objectContaining({
        uri: `${buildResourceUri('system', ['browser'])}#notice`,
        notice: true,
      }),
    )
  })

  it('returns provider failures as non-selectable notices instead of a false empty result', async () => {
    const registry = createResourceProviderRegistry()
    registry.register({
      ...provider('db'),
      title: 'Databases',
      listChildren: async () => {
        throw new Error('connection secret must not reach the client')
      },
    })

    const result = await registry.browse('u', buildResourceUri('db'))
    expect(result.groups).toEqual([])
    expect(result.notices).toEqual([
      {
        uri: `${buildResourceUri('db')}#notice`,
        label: 'Databases unavailable',
        detail: 'Could not load this resource group',
        hasChildren: false,
        notice: true,
      },
    ])
    expect(JSON.stringify(result)).not.toContain('connection secret')
  })

  it('states the shared response cap in-band so every client explains truncation', async () => {
    const registry = createResourceProviderRegistry()
    registry.register(
      browseProvider(
        'db',
        'Databases',
        Array.from({ length: 55 }, (_, i) => ({
          uri: buildResourceUri('db', [`${i}`]),
          label: `Database ${i}`,
        })),
      ),
    )

    const result = await registry.browse('u', buildResourceUri('db'))
    expect(result.total).toBe(55)
    expect(result.truncated).toBe(true)
    expect(flattenResourceBrowse(result)).toHaveLength(50)
    expect(result.notices).toContainEqual(
      expect.objectContaining({
        label: 'Showing 50 of 55 matching resources',
        notice: true,
      }),
    )
  })

  it('normalizes untrusted provider rows before either client renders them', async () => {
    const registry = createResourceProviderRegistry()
    registry.register({
      ...provider('db'),
      title: '\u001b[31m Databases\n',
      async listChildren() {
        return [
          {
            uri: buildResourceUri('db', ['safe']),
            label: '\u001b]8;;https://example.test\u0007Primary\u001b]8;;\u0007\nDB',
            detail: 'line one\r\nline two',
            group: '\u001b[2JConnections',
            icon: '\u001b[2Jdatabase',
            notice: 'yes',
            navigationOnly: 1,
            providerSecret: 'must-not-cross-the-catalog-boundary',
            hasChildren: false,
            actions: [
              { id: 'link', label: '\u001b[31mLink\u001b[0m\nnow', kind: 'link' },
              { id: 'link', label: 'Duplicate action', kind: 'link' },
              { id: 'bad id', label: 'Unsafe id', kind: 'link' },
            ],
          } as unknown as ResourceNode,
          { uri: buildResourceUri('git', ['foreign']), label: 'Foreign', hasChildren: false },
          {
            uri: `${buildResourceUri('db')}/bad path`,
            label: 'Broken token',
            hasChildren: false,
          },
          { uri: buildResourceUri('db', ['safe']), label: 'Duplicate', hasChildren: false },
        ]
      },
    })

    const result = await registry.browse('u', buildResourceUri('db'))
    expect(flattenResourceBrowse(result)).toEqual([
      {
        uri: buildResourceUri('db', ['safe']),
        label: 'Primary DB',
        detail: 'line one line two',
        group: 'Connections',
        hasChildren: false,
        actions: [{ id: 'link', label: 'Link now', kind: 'link' }],
      },
    ])
    // oxlint-disable-next-line no-control-regex -- verifies the trust-boundary sanitizer
    expect(JSON.stringify(result)).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
    expect(JSON.stringify(result)).not.toContain('must-not-cross-the-catalog-boundary')
  })
})

describe('resource provider trust boundary', () => {
  it('degrades timed-out browse providers without waiting on their promises', async () => {
    const deadlineLabels: string[] = []
    const registry = createResourceProviderRegistry({
      timeoutMs: 123,
      withDeadline: <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
        deadlineLabels.push(`${timeoutMs}:${label}`)
        return label.includes('"stuck"') ? Promise.reject(new Error('synthetic deadline')) : promise
      },
    })
    registry.register({
      ...provider('stuck'),
      title: 'Stuck resources',
      listChildren: () => new Promise<ResourceNode[]>(() => {}),
    })
    registry.register(provider('healthy'))

    const roots = await registry.listChildren('u', null)
    expect(roots.map((node) => node.uri)).toEqual([buildResourceUri('healthy', ['root'])])

    const browsed = await registry.browse('u', buildResourceUri('stuck'))
    expect(browsed.groups).toEqual([])
    expect(browsed.notices).toContainEqual(
      expect.objectContaining({ label: 'Stuck resources unavailable', notice: true }),
    )
    expect(deadlineLabels).toContain('123:resource provider "stuck" listChildren')
  })

  it('soft-fails a timed-out expansion through the same injectable deadline', async () => {
    const deadlineLabels: string[] = []
    const registry = createResourceProviderRegistry({
      timeoutMs: 321,
      withDeadline: <T>(_promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
        deadlineLabels.push(`${timeoutMs}:${label}`)
        return Promise.reject(new Error('synthetic deadline'))
      },
    })
    registry.register({
      ...provider('stuck'),
      title: 'Stuck resources',
      expand: () => new Promise(() => {}),
    })

    expect(await registry.expand('u', buildResourceUri('stuck', ['root']))).toEqual({
      ok: false,
      error: 'Stuck resources unavailable',
    })
    expect(deadlineLabels).toEqual(['321:resource provider "stuck" expand'])
  })

  it('bounds provider rows, presentation fields, actions, and UTF-8 expansion bytes', async () => {
    const registry = createResourceProviderRegistry({
      maxNodesPerProvider: 2,
      maxExpansionBytes: 64,
    })
    registry.register({
      ...provider('large'),
      async listChildren() {
        return Array.from({ length: 3 }, (_, index) => ({
          uri: buildResourceUri('large', [`${index}`]),
          label: `row-${index}-${'x'.repeat(10_000)}`,
          detail: 'd'.repeat(10_000),
          hasChildren: false,
          actions: Array.from({ length: 30 }, (__, actionIndex) => ({
            id: `a${actionIndex}`,
            label: `action-${actionIndex}`,
            kind: 'link' as const,
          })),
        }))
      },
      async expand() {
        return { ok: true, content: '🧠'.repeat(1_000), language: 'markdown' }
      },
    })

    const nodes = await registry.listChildren('u', buildResourceUri('large', ['root']))
    expect(nodes).toHaveLength(2)
    expect(nodes[0]?.label.length).toBeLessThanOrEqual(512)
    expect(nodes[0]?.detail?.length).toBeLessThanOrEqual(2_000)
    expect(nodes[0]?.actions).toHaveLength(16)

    const expansion = await registry.expand('u', buildResourceUri('large', ['root']))
    expect(expansion.ok).toBe(true)
    expect(expansion.content).toEndWith('\n[resource expansion truncated]')
    expect(Buffer.byteLength(expansion.content ?? '', 'utf8')).toBeLessThanOrEqual(64)
    expect(expansion.content).not.toContain('\uFFFD')
    expect(expansion.language).toBe('markdown')
  })
})
