/**
 * The Kubernetes routes, exercised through Hono's own `app.request()` — no server, no port.
 *
 * This file exists because the mini app had NO route test at all, and the two claims most worth
 * pinning are boundary ones the service tests cannot see:
 *
 *  1. A validation failure answers the SAME `{ error, code, detail }` body every other failure
 *     follows. It did not: bare `zValidator` returned `{success:false, error:ZodError}`, which the
 *     workbench client turned into the literal message `[object Object]`.
 *  2. The generic any-kind endpoints exist and pass their parameters through, including the
 *     string→number coercion a query string forces and the "unknown kind" 404.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createKubernetesRoutes } from './routes'
import { KubeError } from './errors'
import type { KubeApiResources, KubeGenericList } from './contracts'
import type { KubernetesService } from './service'

const RESOURCES: KubeApiResources = {
  resources: [
    { apiVersion: 'v1', kind: 'Pod', plural: 'pods', namespaced: true },
    {
      apiVersion: 'cert-manager.io/v1',
      kind: 'Certificate',
      plural: 'certificates',
      namespaced: true,
    },
  ],
  unavailable: ['metrics.k8s.io/v1beta1'],
}

const LIST: KubeGenericList = {
  apiVersion: 'cert-manager.io/v1',
  kind: 'Certificate',
  namespaced: true,
  rows: [
    { name: 'api-tls', namespace: 'prod', createdAt: '2026-07-01T10:00:00Z', status: 'Ready' },
  ],
  truncated: false,
}

/** Only the methods a test's route actually reaches — touching any other would throw. */
function stubService(over: Partial<KubernetesService> = {}): KubernetesService {
  return {
    listApiResources: async () => RESOURCES,
    listByKind: async () => LIST,
    ...over,
  } as unknown as KubernetesService
}

const body = async (res: Response) => (await res.json()) as Record<string, unknown>

describe('validation failures answer the typed body, not a raw ZodError', () => {
  test('a missing required query param', async () => {
    const res = await createKubernetesRoutes(stubService()).request('/objects')
    expect(res.status).toBe(400)
    const b = await body(res)
    expect(b.code).toBe('invalid_request')
    expect(typeof b.error).toBe('string')
    // The raw safeParse shape must never reach the wire — the client reads `error` as a string and
    // an object there renders as "[object Object]".
    expect(b).not.toHaveProperty('success')
    expect(b.detail).toContain('kind')
  })

  test('an out-of-range numeric query param', async () => {
    const app = createKubernetesRoutes(stubService())
    const res = await app.request('/objects?kind=pods&limit=0')
    expect(res.status).toBe(400)
    const b = await body(res)
    expect(b.code).toBe('invalid_request')
    expect(b).not.toHaveProperty('success')
  })

  test('a blank context is rejected as invalid rather than treated as "current"', async () => {
    // `?context=` with an empty value is a UI bug, not a request for the current context — the
    // schema says min(1), and the answer has to be the typed body like any other.
    const res = await createKubernetesRoutes(stubService()).request('/api-resources?context=')
    expect(res.status).toBe(400)
    expect((await body(res)).code).toBe('invalid_request')
  })
})

describe('GET /api-resources', () => {
  test('returns the discovered kinds AND the group-versions it could not reach', async () => {
    const res = await createKubernetesRoutes(stubService()).request('/api-resources')
    expect(res.status).toBe(200)
    const b = await body(res)
    expect(b.resources).toHaveLength(2)
    // Dropping `unavailable` would make a down aggregated API look like a cluster without the kind.
    expect(b.unavailable).toEqual(['metrics.k8s.io/v1beta1'])
  })

  test('forwards ?context= to the service', async () => {
    let seen: string | undefined = 'unset'
    const app = createKubernetesRoutes(
      stubService({
        listApiResources: async (context) => {
          seen = context
          return RESOURCES
        },
      }),
    )
    await app.request('/api-resources?context=staging')
    expect(seen).toBe('staging')
  })
})

describe('GET /objects', () => {
  test('returns the generic list', async () => {
    const res = await createKubernetesRoutes(stubService()).request('/objects?kind=certificates')
    expect(res.status).toBe(200)
    expect(await body(res)).toEqual(LIST as unknown as Record<string, unknown>)
  })

  test('forwards kind, namespace, context and a COERCED numeric limit', async () => {
    const seen: unknown[] = []
    const app = createKubernetesRoutes(
      stubService({
        listByKind: async (kind, namespace, opts) => {
          seen.push({ kind, namespace, opts })
          return LIST
        },
      }),
    )
    await app.request('/objects?kind=certificates&namespace=prod&context=staging&limit=25')
    // A query string is text; without coercion `limit` would reach the backend as "25" and the
    // `limit + 1` truncation probe would compute "251".
    expect(seen[0]).toEqual({
      kind: 'certificates',
      namespace: 'prod',
      opts: { context: 'staging', limit: 25 },
    })
  })

  test('an unknown kind is the same typed 404 as any other missing resource', async () => {
    const app = createKubernetesRoutes(stubService({ listByKind: async () => null }))
    const res = await app.request('/objects?kind=widgets')
    expect(res.status).toBe(404)
    const b = await body(res)
    expect(b.code).toBe('not_found')
    // Per the typed-error contract, `error` is the friendly sentence and the specific text lands in
    // `detail` — so the kind the caller asked for must be there, not lost.
    expect(b.error).toBe('Resource not found.')
    expect(b.detail).toContain('widgets')
  })

  test('an unreachable cluster is a 503, not a 400', async () => {
    const app = createKubernetesRoutes(
      stubService({
        listByKind: async () => {
          throw new KubeError('context_unreachable', 'dial tcp timeout')
        },
      }),
    )
    const res = await app.request('/objects?kind=pods')
    // 503 is what the sidebar renders as a quiet empty state instead of an error toast.
    expect(res.status).toBe(503)
    expect((await body(res)).code).toBe('context_unreachable')
  })
})

describe('usage metrics answer absence as data, not as an error', () => {
  const usage = [
    {
      namespace: 'prod',
      name: 'api-1',
      cpuNanos: 12_000_000,
      memoryBytes: 1024,
      containers: [{ name: 'app', cpuNanos: 12_000_000, memoryBytes: 1024 }],
    },
  ]

  test('pod usage passes namespace + context through and returns rows', async () => {
    const seen: [string, string | undefined][] = []
    const app = createKubernetesRoutes(
      stubService({
        podMetrics: async (namespace, context) => {
          seen.push([namespace, context])
          return usage
        },
      }),
    )
    const res = await app.request('/metrics/pods?namespace=prod&context=kind-dev')
    expect(res.status).toBe(200)
    expect(seen).toEqual([['prod', 'kind-dev']])
    expect((await body(res)).pods).toEqual(usage)
  })

  test('an omitted namespace reaches the service as the same empty string the lists use', async () => {
    const seen: string[] = []
    const app = createKubernetesRoutes(
      stubService({
        podMetrics: async (namespace) => {
          seen.push(namespace)
          return []
        },
      }),
    )
    await app.request('/metrics/pods')
    expect(seen).toEqual([''])
  })

  test('a cluster with no metrics-server answers 200 with null, NOT 503', async () => {
    // The claim worth pinning: a missing optional add-on must not look like a broken
    // cluster, or the pod list this decorates would go into its error state.
    const app = createKubernetesRoutes(
      stubService({ podMetrics: async () => null, nodeMetrics: async () => null }),
    )
    const pods = await app.request('/metrics/pods?namespace=prod')
    expect(pods.status).toBe(200)
    expect((await body(pods)).pods).toBeNull()
    const nodes = await app.request('/metrics/nodes')
    expect(nodes.status).toBe(200)
    expect((await body(nodes)).nodes).toBeNull()
  })

  test('an unreachable cluster still surfaces as a typed 503', async () => {
    // Absence is data; a broken CONTEXT is not, and must keep its typed failure.
    const app = createKubernetesRoutes(
      stubService({
        nodeMetrics: async () => {
          throw new KubeError('context_unreachable', 'dial tcp timeout')
        },
      }),
    )
    const res = await app.request('/metrics/nodes')
    expect(res.status).toBe(503)
    expect((await body(res)).code).toBe('context_unreachable')
  })
})

describe('every route validator goes through the typed hook', () => {
  test('routes.ts never calls zValidator directly', () => {
    // Structural, because the defect is INVISIBLE at the call site: a bare `zValidator` compiles,
    // serves traffic, and only misbehaves on malformed input. One missed call site is one endpoint
    // leaking ZodError again, and no other test would notice.
    const source = readFileSync(new URL('./routes.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('zValidator')
    expect(source).toContain('validated(')

    // Positive control: the check above only means something if the file really does validate.
    const validators = source.match(/validated\(/g) ?? []
    expect(validators.length).toBeGreaterThan(20)
  })
})
