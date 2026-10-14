import { describe, expect, test } from 'bun:test'
import {
  buildLabelSelector,
  parseContexts,
  parseDeployments,
  parseDeploymentSelector,
  parseEvents,
  parseNamespaces,
  parseNodes,
  parsePod,
  parsePods,
  parseServices,
} from './parse'
import { KubeError, mapKubeError } from './errors'

describe('parseContexts', () => {
  test('parses contexts + current-context flag from config view', () => {
    const stdout = JSON.stringify({
      'current-context': 'prod',
      contexts: [
        { name: 'prod', context: { cluster: 'prod-cluster', namespace: 'apps' } },
        { name: 'dev', context: { cluster: 'dev-cluster' } },
      ],
    })
    const { contexts, current } = parseContexts(stdout)
    expect(current).toBe('prod')
    expect(contexts).toHaveLength(2)
    expect(contexts[0]).toMatchObject({
      name: 'prod',
      cluster: 'prod-cluster',
      namespace: 'apps',
      current: true,
    })
    expect(contexts[1]).toMatchObject({ name: 'dev', namespace: '', current: false })
  })

  test('empty/invalid output → empty', () => {
    expect(parseContexts('')).toEqual({ contexts: [], current: '' })
    expect(parseContexts('not json')).toEqual({ contexts: [], current: '' })
  })
})

describe('parseNamespaces', () => {
  test('parses namespace items with phase', () => {
    const stdout = JSON.stringify({
      items: [
        { metadata: { name: 'default' }, status: { phase: 'Active' } },
        { metadata: { name: 'kube-system' }, status: {} },
      ],
    })
    const ns = parseNamespaces(stdout)
    expect(ns).toHaveLength(2)
    expect(ns[0]).toEqual({ name: 'default', phase: 'Active' })
    expect(ns[1]).toEqual({ name: 'kube-system', phase: 'Active' })
  })
})

describe('parsePods', () => {
  test('computes ready/restarts/reason from container statuses', () => {
    const stdout = JSON.stringify({
      items: [
        {
          metadata: {
            uid: 'uid-api-abc',
            resourceVersion: '42',
            name: 'api-abc',
            namespace: 'apps',
            creationTimestamp: '2026-07-01T10:00:00Z',
          },
          spec: { nodeName: 'node-1', containers: [{ name: 'api' }, { name: 'sidecar' }] },
          status: {
            phase: 'Running',
            podIP: '10.0.0.5',
            containerStatuses: [
              { name: 'api', ready: true, restartCount: 2, state: { running: {} } },
              {
                name: 'sidecar',
                ready: false,
                restartCount: 5,
                state: { waiting: { reason: 'CrashLoopBackOff' } },
              },
            ],
          },
        },
      ],
    })
    const pods = parsePods(stdout)
    expect(pods).toHaveLength(1)
    expect(pods[0]).toMatchObject({
      uid: 'uid-api-abc',
      resourceVersion: '42',
      name: 'api-abc',
      namespace: 'apps',
      phase: 'Running',
      ready: '1/2',
      readyCount: 1,
      totalCount: 2,
      restarts: 7,
      node: 'node-1',
      podIP: '10.0.0.5',
      reason: 'CrashLoopBackOff',
      containers: ['api', 'sidecar'],
    })
  })

  test('unknown phase normalises to Unknown; empty items → []', () => {
    const stdout = JSON.stringify({
      items: [{ metadata: { name: 'p' }, status: { phase: 'Weird' } }],
    })
    expect(parsePods(stdout)[0]?.phase).toBe('Unknown')
    expect(parsePods('')).toEqual([])
  })

  test('reads de-duped TCP ports with their container metadata', () => {
    const stdout = JSON.stringify({
      items: [
        {
          metadata: { name: 'p', namespace: 'apps' },
          spec: {
            containers: [
              {
                name: 'app',
                ports: [
                  { name: 'http', containerPort: 8080 },
                  { name: 'metrics', containerPort: 9090 },
                  { name: 'dns', containerPort: 5353, protocol: 'UDP' },
                ],
              },
              { name: 'metrics', ports: [{ containerPort: 9090 }] }, // dup dropped
            ],
          },
          status: { phase: 'Running' },
        },
      ],
    })
    expect(parsePods(stdout)[0]?.containerPorts).toEqual([
      { container: 'app', name: 'http', port: 8080, protocol: 'TCP', probe: null },
      { container: 'app', name: 'metrics', port: 9090, protocol: 'TCP', probe: null },
    ])
  })

  test('marks the readiness port even when a dormant debug port is declared first', () => {
    const stdout = JSON.stringify({
      items: [
        {
          metadata: { name: 'api', namespace: 'apps' },
          spec: {
            containers: [
              {
                name: 'service',
                ports: [
                  { name: 'debug', containerPort: 4444, protocol: 'TCP' },
                  { name: 'grpc', containerPort: 5000, protocol: 'TCP' },
                  { name: 'http', containerPort: 4000, protocol: 'TCP' },
                ],
                readinessProbe: { httpGet: { path: '/health', port: 'http' } },
                livenessProbe: { httpGet: { path: '/health', port: 'http' } },
              },
            ],
          },
          status: { phase: 'Running' },
        },
      ],
    })

    expect(parsePods(stdout)[0]?.containerPorts).toEqual([
      { container: 'service', name: 'debug', port: 4444, protocol: 'TCP', probe: null },
      { container: 'service', name: 'grpc', port: 5000, protocol: 'TCP', probe: null },
      { container: 'service', name: 'http', port: 4000, protocol: 'TCP', probe: 'readiness' },
    ])
  })

  test('includes a numeric probe port even when containerPort metadata is absent', () => {
    const stdout = JSON.stringify({
      items: [
        {
          metadata: { name: 'api' },
          spec: {
            containers: [
              {
                name: 'api',
                readinessProbe: { tcpSocket: { port: 8080 } },
              },
            ],
          },
          status: {},
        },
      ],
    })
    expect(parsePods(stdout)[0]?.containerPorts).toEqual([
      { container: 'api', name: '', port: 8080, protocol: 'TCP', probe: 'readiness' },
    ])
  })

  test('containerPorts empty when no ports declared', () => {
    const stdout = JSON.stringify({
      items: [{ metadata: { name: 'p' }, spec: { containers: [{ name: 'c' }] }, status: {} }],
    })
    expect(parsePods(stdout)[0]?.containerPorts).toEqual([])
  })

  test('requests are summed across containers, in base units', () => {
    // This is the scheduler's reservation, which is what explains an unschedulable pod —
    // and it comes from the spec, so it is available with no metrics-server at all.
    const stdout = JSON.stringify({
      items: [
        {
          metadata: { name: 'p', namespace: 'apps' },
          spec: {
            containers: [
              { name: 'app', resources: { requests: { cpu: '250m', memory: '512Mi' } } },
              { name: 'sidecar', resources: { requests: { cpu: '50m', memory: '64Mi' } } },
            ],
          },
          status: { phase: 'Running' },
        },
      ],
    })
    expect(parsePods(stdout)[0]).toMatchObject({
      requestedCpuNanos: 300_000_000,
      requestedMemoryBytes: (512 + 64) * 1024 * 1024,
    })
  })

  test('only `requests` is read — limits are never counted as a reservation', () => {
    // The API server defaults a container's requests to its limits when requests are
    // omitted, so a live spec already carries them. Reading `limits` too would
    // double-count that pod's reservation.
    const stdout = JSON.stringify({
      items: [
        {
          metadata: { name: 'p' },
          spec: {
            containers: [
              { name: 'a' },
              { name: 'b', resources: { limits: { cpu: '2', memory: '1Gi' } } },
            ],
          },
          status: {},
        },
      ],
    })
    expect(parsePods(stdout)[0]).toMatchObject({
      requestedCpuNanos: 0,
      requestedMemoryBytes: 0,
    })
  })
})

describe('parsePod (single document)', () => {
  test('parses a single Pod document into a row', () => {
    const stdout = JSON.stringify({
      kind: 'Pod',
      metadata: { name: 'solo', namespace: 'apps' },
      spec: { containers: [{ name: 'c', ports: [{ containerPort: 80 }] }] },
      status: { phase: 'Running', containerStatuses: [{ ready: true, restartCount: 0 }] },
    })
    const pod = parsePod(stdout)
    expect(pod).toMatchObject({
      name: 'solo',
      namespace: 'apps',
      phase: 'Running',
      containerPorts: [{ container: 'c', name: '', port: 80, protocol: 'TCP', probe: null }],
    })
  })

  test('empty / non-Pod / a List document → null', () => {
    expect(parsePod('')).toBeNull()
    expect(parsePod('not json')).toBeNull()
    expect(parsePod(JSON.stringify({ kind: 'Service', metadata: { name: 's' } }))).toBeNull()
  })
})

describe('parseDeployments / parseServices', () => {
  test('deployments ready display', () => {
    const stdout = JSON.stringify({
      items: [
        {
          metadata: { name: 'web', namespace: 'apps' },
          spec: { replicas: 3 },
          status: { readyReplicas: 2, updatedReplicas: 3, availableReplicas: 2 },
        },
      ],
    })
    expect(parseDeployments(stdout)[0]).toMatchObject({
      name: 'web',
      ready: '2/3',
      upToDate: 3,
      available: 2,
    })
  })

  test('services port display', () => {
    const stdout = JSON.stringify({
      items: [
        {
          metadata: { name: 'svc', namespace: 'apps' },
          spec: {
            type: 'ClusterIP',
            clusterIP: '10.1.2.3',
            ports: [{ port: 80, protocol: 'TCP' }, { port: 443 }],
          },
        },
      ],
    })
    expect(parseServices(stdout)[0]).toMatchObject({
      name: 'svc',
      type: 'ClusterIP',
      clusterIP: '10.1.2.3',
      ports: '80/TCP,443/TCP',
    })
  })
})

describe('parseNodes', () => {
  test('parses status, roles, version and schedulable', () => {
    const stdout = JSON.stringify({
      items: [
        {
          metadata: {
            name: 'cp-1',
            creationTimestamp: '2026-06-01T00:00:00Z',
            labels: {
              'node-role.kubernetes.io/control-plane': '',
              'node-role.kubernetes.io/master': '',
            },
          },
          spec: { unschedulable: true },
          status: {
            conditions: [{ type: 'Ready', status: 'True' }],
            nodeInfo: { kubeletVersion: 'v1.29.2' },
            // Real kubelet spellings: cores as a bare integer, memory in Ki.
            capacity: { cpu: '8', memory: '16331528Ki' },
            allocatable: { cpu: '7910m', memory: '15707912Ki' },
          },
        },
        {
          metadata: { name: 'worker-1', labels: {} },
          spec: {},
          status: {
            conditions: [{ type: 'Ready', status: 'False' }],
            nodeInfo: { kubeletVersion: 'v1.29.2' },
          },
        },
      ],
    })
    const nodes = parseNodes(stdout)
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toMatchObject({
      name: 'cp-1',
      status: 'Ready',
      roles: ['control-plane', 'master'],
      version: 'v1.29.2',
      schedulable: false,
    })
    expect(nodes[1]).toMatchObject({
      name: 'worker-1',
      status: 'NotReady',
      roles: [],
      schedulable: true,
    })
  })

  test('allocatable is the reported denominator, not capacity', () => {
    // A percentage against capacity understates pressure by the kubelet/system reserve,
    // so the row must carry allocatable even though both are present in the payload.
    const nodes = parseNodes(
      JSON.stringify({
        items: [
          {
            metadata: { name: 'cp-1', labels: {} },
            status: {
              capacity: { cpu: '8', memory: '16331528Ki' },
              allocatable: { cpu: '7910m', memory: '15707912Ki' },
            },
          },
        ],
      }),
    )
    expect(nodes[0]).toMatchObject({
      allocatableCpuNanos: 7_910_000_000,
      allocatableMemoryBytes: 15_707_912 * 1024,
    })
  })

  test('a node that advertises no allocatable block reports zero, not NaN', () => {
    // Zero is the UI's "no percentage available" signal; NaN would render as "NaN%".
    const nodes = parseNodes(
      JSON.stringify({ items: [{ metadata: { name: 'edge-1', labels: {} }, status: {} }] }),
    )
    expect(nodes[0]).toMatchObject({ allocatableCpuNanos: 0, allocatableMemoryBytes: 0 })
  })

  test('empty → []', () => {
    expect(parseNodes('')).toEqual([])
  })
})

describe('deployment selector helpers', () => {
  test('parseDeploymentSelector reads spec.selector.matchLabels from a single doc', () => {
    const stdout = JSON.stringify({
      spec: { selector: { matchLabels: { app: 'web', tier: 'frontend' } } },
    })
    expect(parseDeploymentSelector(stdout)).toEqual({ app: 'web', tier: 'frontend' })
  })
  test('parseDeploymentSelector tolerates missing selector', () => {
    expect(parseDeploymentSelector('{}')).toEqual({})
    expect(parseDeploymentSelector('')).toEqual({})
  })
  test('buildLabelSelector joins sorted k=v pairs', () => {
    expect(buildLabelSelector({ tier: 'frontend', app: 'web' })).toBe('app=web,tier=frontend')
    expect(buildLabelSelector({})).toBe('')
  })
})

describe('parseEvents', () => {
  test('parses events, defaults count/type, sorts newest first', () => {
    const stdout = JSON.stringify({
      items: [
        {
          type: 'Normal',
          reason: 'Scheduled',
          message: 'assigned',
          lastTimestamp: '2026-07-01T10:00:00Z',
          source: { component: 'scheduler' },
        },
        {
          reason: 'BackOff',
          message: 'restarting',
          count: 4,
          lastTimestamp: '2026-07-01T10:05:00Z',
          reportingComponent: 'kubelet',
        },
      ],
    })
    const events = parseEvents(stdout)
    expect(events).toHaveLength(2)
    // Newest (10:05) first.
    expect(events[0]).toMatchObject({
      reason: 'BackOff',
      count: 4,
      type: 'Normal',
      source: 'kubelet',
    })
    expect(events[1]).toMatchObject({ reason: 'Scheduled', count: 1, source: 'scheduler' })
  })

  test('empty → []', () => {
    expect(parseEvents('')).toEqual([])
  })
})

describe('mapKubeError', () => {
  test('no kubeconfig → no_kubeconfig', () => {
    expect(
      mapKubeError(
        new Error(
          'error: no configuration has been provided, try setting KUBERNETES_MASTER environment variable',
        ),
      ).code,
    ).toBe('no_kubeconfig')
  })
  test('unreachable API server → context_unreachable', () => {
    expect(
      mapKubeError(
        new Error(
          'Unable to connect to the server: dial tcp 127.0.0.1:6443: connect: connection refused',
        ),
      ).code,
    ).toBe('context_unreachable')
  })
  test('object client generic connection copy → context_unreachable', () => {
    expect(
      mapKubeError(new Error('Unable to connect. Is the computer able to access the url?')).code,
    ).toBe('context_unreachable')
  })
  test('credential plugin failure wins over its generic unreachable tail', () => {
    expect(
      mapKubeError(
        new Error(
          'getting credentials: exec: executable gke-gcloud-auth-plugin failed: invalid_grant\n' +
            'Please run: gcloud auth login\nUnable to connect to the server',
        ),
      ).code,
    ).toBe('authentication_failed')
  })
  test('RBAC forbidden → permission_denied', () => {
    expect(
      mapKubeError(
        new Error('pods is forbidden: User "dev" cannot list resource "pods" in API group ""'),
      ).code,
    ).toBe('permission_denied')
  })
  test('missing context → invalid_context', () => {
    expect(mapKubeError(new Error('context "gone" does not exist')).code).toBe('invalid_context')
  })
  test('certificate verification → certificate_error', () => {
    expect(mapKubeError(new Error('x509: certificate signed by unknown authority')).code).toBe(
      'certificate_error',
    )
    expect(mapKubeError(new Error('self signed certificate in certificate chain')).code).toBe(
      'certificate_error',
    )
  })
  test('bounded API request expiry → command_timeout', () => {
    expect(mapKubeError(new Error('Kubernetes API timed out after 30000ms')).code).toBe(
      'command_timeout',
    )
  })
  test('not found → not_found', () => {
    expect(
      mapKubeError(new Error('Error from server (NotFound): pods "bogus" not found')).code,
    ).toBe('not_found')
  })
  test('maps the object-client ApiException shape', () => {
    const mapped = mapKubeError({
      code: 403,
      body: { message: 'pods is forbidden for this identity' },
    })
    expect(mapped.code).toBe('permission_denied')
    expect(mapped.message).toBe('pods is forbidden for this identity')
  })
  test('other → kube_error', () => {
    expect(mapKubeError(new Error('some weird failure')).code).toBe('kube_error')
  })
  test('passes an existing KubeError through unchanged', () => {
    const e = new KubeError('kube_error')
    expect(mapKubeError(e)).toBe(e)
  })
})
