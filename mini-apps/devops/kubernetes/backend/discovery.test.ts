import { describe, expect, test } from 'bun:test'
import {
  type DiscoveredResource,
  listableResources,
  normalizeGenericRow,
  parseApiResourceList,
  preferredGroupVersions,
  resolveResource,
} from './discovery'

/**
 * Shapes are copied from real cluster responses, not invented: the core list interleaves
 * subresources with resources, `singularName` is genuinely `''` for core kinds, and short names are
 * present on some entries only. Every trap in `discovery.ts` is exercised from the shape that
 * produces it, because a fixture that omits the trap proves nothing.
 */
const CORE_V1 = {
  kind: 'APIResourceList',
  groupVersion: 'v1',
  resources: [
    {
      name: 'pods',
      singularName: '',
      namespaced: true,
      kind: 'Pod',
      verbs: ['get', 'list', 'watch', 'delete'],
      shortNames: ['po'],
    },
    { name: 'pods/log', singularName: '', namespaced: true, kind: 'Pod', verbs: ['get'] },
    {
      name: 'pods/exec',
      singularName: '',
      namespaced: true,
      kind: 'PodExecOptions',
      verbs: ['create', 'get'],
    },
    {
      name: 'configmaps',
      singularName: '',
      namespaced: true,
      kind: 'ConfigMap',
      verbs: ['get', 'list', 'watch'],
      shortNames: ['cm'],
    },
    {
      name: 'nodes',
      singularName: '',
      namespaced: false,
      kind: 'Node',
      verbs: ['get', 'list', 'watch'],
      shortNames: ['no'],
    },
    {
      name: 'componentstatuses',
      singularName: '',
      namespaced: false,
      kind: 'ComponentStatus',
      verbs: ['get', 'list'],
      shortNames: ['cs'],
    },
    // Real entry with no `list` verb — creating a token review is not a table.
    {
      name: 'serviceaccounts/token',
      singularName: '',
      namespaced: true,
      kind: 'TokenRequest',
      verbs: ['create'],
    },
  ],
}

const APPS_V1 = {
  resources: [
    {
      name: 'deployments',
      singularName: 'deployment',
      namespaced: true,
      kind: 'Deployment',
      verbs: ['get', 'list', 'watch'],
      shortNames: ['deploy'],
    },
    {
      name: 'deployments/scale',
      singularName: '',
      namespaced: true,
      kind: 'Scale',
      verbs: ['get', 'patch', 'update'],
    },
  ],
}

const CERT_MANAGER_V1 = {
  resources: [
    {
      name: 'certificates',
      singularName: 'certificate',
      namespaced: true,
      kind: 'Certificate',
      verbs: ['get', 'list', 'watch'],
      shortNames: ['cert', 'certs'],
    },
  ],
}

/** A second group serving the SAME kind — the ambiguity that makes match ORDER load-bearing. */
const LEGACY_CERTS_V1 = {
  resources: [
    {
      name: 'certificates',
      singularName: 'certificate',
      namespaced: true,
      kind: 'Certificate',
      verbs: ['get', 'list'],
    },
  ],
}

const APIS = {
  kind: 'APIGroupList',
  groups: [
    {
      name: 'apps',
      versions: [{ groupVersion: 'apps/v1', version: 'v1' }],
      preferredVersion: { groupVersion: 'apps/v1', version: 'v1' },
    },
    {
      name: 'cert-manager.io',
      // Non-preferred version FIRST on purpose: reading `versions[0]` must not pass this test.
      versions: [
        { groupVersion: 'cert-manager.io/v1beta1', version: 'v1beta1' },
        { groupVersion: 'cert-manager.io/v1', version: 'v1' },
      ],
      preferredVersion: { groupVersion: 'cert-manager.io/v1', version: 'v1' },
    },
  ],
}

const all = (): DiscoveredResource[] => [
  ...parseApiResourceList('v1', CORE_V1),
  ...parseApiResourceList('apps/v1', APPS_V1),
  ...parseApiResourceList('cert-manager.io/v1', CERT_MANAGER_V1),
]

describe('parseApiResourceList', () => {
  test('drops subresources and keeps the listable kinds', () => {
    const core = parseApiResourceList('v1', CORE_V1)
    const names = core.map((r) => r.plural)
    expect(names).toContain('pods')
    expect(names).toContain('configmaps')
    // Subresources share a kind with their parent; keeping them would list `Pod` twice.
    expect(names).not.toContain('pods/log')
    expect(names).not.toContain('pods/exec')
    expect(names.some((n) => n.includes('/'))).toBe(false)
  })

  test('carries apiVersion, scope and short names through', () => {
    const pods = parseApiResourceList('v1', CORE_V1).find((r) => r.plural === 'pods')
    expect(pods).toEqual({
      apiVersion: 'v1',
      kind: 'Pod',
      plural: 'pods',
      singular: '',
      shortNames: ['po'],
      namespaced: true,
      verbs: ['get', 'list', 'watch', 'delete'],
    })
    const nodes = parseApiResourceList('v1', CORE_V1).find((r) => r.plural === 'nodes')
    // Cluster-scoped: a namespace in the request URL would 404.
    expect(nodes?.namespaced).toBe(false)
  })

  test('a group apiVersion is preserved verbatim so the object API can address it', () => {
    const deploy = parseApiResourceList('apps/v1', APPS_V1).find((r) => r.kind === 'Deployment')
    expect(deploy?.apiVersion).toBe('apps/v1')
  })

  test('malformed bodies yield nothing instead of throwing', () => {
    expect(parseApiResourceList('v1', null)).toEqual([])
    expect(parseApiResourceList('v1', undefined)).toEqual([])
    expect(parseApiResourceList('v1', {})).toEqual([])
    expect(parseApiResourceList('v1', { resources: 'nope' })).toEqual([])
    expect(parseApiResourceList('v1', { resources: [{}, { name: 'x' }, { kind: 'Y' }] })).toEqual(
      [],
    )
    expect(parseApiResourceList('v1', { resources: [{ name: 1, kind: 2 }] })).toEqual([])
  })

  test('non-string verbs and shortNames are filtered, not propagated', () => {
    const [only] = parseApiResourceList('v1', {
      resources: [
        { name: 'things', kind: 'Thing', verbs: ['list', 7, null], shortNames: [3, 'th'] },
      ],
    })
    expect(only?.verbs).toEqual(['list'])
    expect(only?.shortNames).toEqual(['th'])
  })
})

describe('preferredGroupVersions', () => {
  test('returns one group-version per group — the preferred one', () => {
    // cert-manager serves v1 AND v1beta1; asking both would duplicate every Certificate.
    expect(preferredGroupVersions(APIS)).toEqual(['apps/v1', 'cert-manager.io/v1'])
  })

  test('skips groups without a preferred version and survives malformed input', () => {
    expect(preferredGroupVersions({ groups: [{ name: 'broken' }, ...APIS.groups] })).toEqual([
      'apps/v1',
      'cert-manager.io/v1',
    ])
    expect(preferredGroupVersions(null)).toEqual([])
    expect(preferredGroupVersions({})).toEqual([])
    expect(preferredGroupVersions({ groups: {} })).toEqual([])
  })
})

describe('resolveResource', () => {
  test('resolves plural, kind, singular and short name, case-insensitively', () => {
    const rs = all()
    for (const query of ['pods', 'Pod', 'po', ' PODS ', 'pOd']) {
      expect(resolveResource(rs, query)?.kind).toBe('Pod')
    }
    expect(resolveResource(rs, 'deploy')?.kind).toBe('Deployment')
    expect(resolveResource(rs, 'deployment')?.kind).toBe('Deployment')
    expect(resolveResource(rs, 'cm')?.kind).toBe('ConfigMap')
    expect(resolveResource(rs, 'certs')?.apiVersion).toBe('cert-manager.io/v1')
  })

  test('a resource the API cannot list is never resolved', () => {
    // `TokenRequest` has verbs ['create'] only. Resolving it would turn "not a table" into a 405.
    const rs = parseApiResourceList('v1', {
      resources: [{ name: 'tokenreviews', kind: 'TokenReview', verbs: ['create'] }],
    })
    expect(resolveResource(rs, 'tokenreviews')).toBeNull()
    expect(resolveResource(rs, 'TokenReview')).toBeNull()
  })

  test('`<plural>.<group>` disambiguates two groups serving the same kind', () => {
    // Order reversed on purpose: a first-match-wins resolver would answer `legacy` for both.
    const rs = [
      ...parseApiResourceList('legacy.example.com/v1', LEGACY_CERTS_V1),
      ...parseApiResourceList('cert-manager.io/v1', CERT_MANAGER_V1),
    ]
    expect(resolveResource(rs, 'certificates.cert-manager.io')?.apiVersion).toBe(
      'cert-manager.io/v1',
    )
    expect(resolveResource(rs, 'certificates.legacy.example.com')?.apiVersion).toBe(
      'legacy.example.com/v1',
    )
    // The bare word stays ambiguous and takes the first listable match — documented, not silent.
    expect(resolveResource(rs, 'certificates')?.apiVersion).toBe('legacy.example.com/v1')
  })

  test('plural wins over a colliding short name', () => {
    // `cs` is ComponentStatus' short name here; a resource literally NAMED `cs` must win it.
    const rs = [
      ...parseApiResourceList('v1', CORE_V1),
      ...parseApiResourceList('x.example.com/v1', {
        resources: [{ name: 'cs', kind: 'ClusterSetting', verbs: ['list'] }],
      }),
    ]
    expect(resolveResource(rs, 'cs')?.kind).toBe('ClusterSetting')
  })

  test('unknown and empty queries return null', () => {
    const rs = all()
    expect(resolveResource(rs, 'widgets')).toBeNull()
    expect(resolveResource(rs, '')).toBeNull()
    expect(resolveResource(rs, '   ')).toBeNull()
    expect(resolveResource([], 'pods')).toBeNull()
  })
})

describe('normalizeGenericRow', () => {
  test('reads metadata every object shares', () => {
    expect(
      normalizeGenericRow({
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: {
          name: 'app-config',
          namespace: 'prod',
          creationTimestamp: '2026-07-01T10:00:00Z',
        },
      }),
    ).toEqual({
      name: 'app-config',
      namespace: 'prod',
      createdAt: '2026-07-01T10:00:00Z',
      status: '',
    })
  })

  test('omits namespace for cluster-scoped objects instead of emitting an empty one', () => {
    const row = normalizeGenericRow({ metadata: { name: 'node-1' } })
    expect(row).toEqual({ name: 'node-1', createdAt: '', status: '' })
    expect('namespace' in (row as object)).toBe(false)
  })

  test('a deserialized Date timestamp becomes RFC3339 text, not "[object Date]"', () => {
    const row = normalizeGenericRow({
      metadata: { name: 'p', creationTimestamp: new Date('2026-07-01T10:00:00Z') },
    })
    expect(row?.createdAt).toBe('2026-07-01T10:00:00.000Z')
  })

  test('status.phase wins, then a Ready condition, and Unknown is not flattened', () => {
    expect(
      normalizeGenericRow({ metadata: { name: 'p' }, status: { phase: 'Running' } })?.status,
    ).toBe('Running')
    const cond = (value: string) => ({
      metadata: { name: 'c' },
      status: { conditions: [{ type: 'Ready', status: value }] },
    })
    expect(normalizeGenericRow(cond('True'))?.status).toBe('Ready')
    expect(normalizeGenericRow(cond('False'))?.status).toBe('NotReady')
    // 'Unknown' is a real third state in the condition convention — reporting NotReady would lie.
    expect(normalizeGenericRow(cond('Unknown'))?.status).toBe('Ready=Unknown')
    // A phase present alongside conditions must not be overridden by the condition.
    expect(
      normalizeGenericRow({
        metadata: { name: 'p' },
        status: { phase: 'Pending', conditions: [{ type: 'Ready', status: 'False' }] },
      })?.status,
    ).toBe('Pending')
  })

  test('conditions without a Ready entry give no status rather than a wrong one', () => {
    expect(
      normalizeGenericRow({
        metadata: { name: 'x' },
        status: { conditions: [{ type: 'Progressing', status: 'True' }] },
      })?.status,
    ).toBe('')
  })

  test('a nameless or malformed object is not a row', () => {
    expect(normalizeGenericRow({ metadata: {} })).toBeNull()
    expect(normalizeGenericRow({})).toBeNull()
    expect(normalizeGenericRow(null)).toBeNull()
    expect(normalizeGenericRow({ metadata: { name: 42 } })).toBeNull()
    expect(normalizeGenericRow({ metadata: { name: 'ok' }, status: 'broken' })?.status).toBe('')
    expect(
      normalizeGenericRow({ metadata: { name: 'ok' }, status: { conditions: 'broken' } })?.status,
    ).toBe('')
  })
})

describe('listableResources', () => {
  test('core first, then groups alphabetically, kinds sorted inside a group', () => {
    const ordered = listableResources([
      ...parseApiResourceList('cert-manager.io/v1', CERT_MANAGER_V1),
      ...parseApiResourceList('apps/v1', APPS_V1),
      ...parseApiResourceList('v1', CORE_V1),
    ]).map((r) => `${r.apiVersion}/${r.kind}`)

    expect(ordered.slice(0, 3)).toEqual(['v1/ComponentStatus', 'v1/ConfigMap', 'v1/Node'])
    expect(ordered.indexOf('apps/v1/Deployment')).toBeLessThan(
      ordered.indexOf('cert-manager.io/v1/Certificate'),
    )
    // The unlistable TokenRequest from CORE_V1 must not appear in a picker.
    expect(ordered.some((id) => id.includes('TokenRequest'))).toBe(false)
  })

  test('de-duplicates by apiVersion+kind', () => {
    const twice = [...parseApiResourceList('v1', CORE_V1), ...parseApiResourceList('v1', CORE_V1)]
    const ids = listableResources(twice).map((r) => `${r.apiVersion}/${r.kind}`)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
