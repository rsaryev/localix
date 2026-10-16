import { describe, expect, test } from 'bun:test'
import {
  createKubernetesResourceProvider,
  type ResourceKubernetesService,
} from './resource-provider'
import type {
  KubeContext,
  KubeDeployment,
  KubeEvent,
  KubeManifest,
  KubeNamespace,
  KubeNode,
  KubePod,
  KubeService,
  PodDescribe,
  PodLogs,
  ResourceDescribe,
} from './contracts'

const ctx: KubeContext = { name: 'prod', cluster: 'prod-cluster', namespace: 'apps', current: true }
const pod: KubePod = {
  uid: 'uid-web-1',
  resourceVersion: '42',
  name: 'web-1',
  namespace: 'apps',
  phase: 'Running',
  ready: '1/1',
  readyCount: 1,
  totalCount: 1,
  restarts: 0,
  node: 'node-1',
  podIP: '10.0.0.5',
  createdAt: '2026-07-01T10:00:00Z',
  containers: ['web'],
  initContainers: [],
  containerPorts: [
    { container: 'api', name: 'http', port: 8080, protocol: 'TCP', probe: 'readiness' },
  ],
  reason: '',
  requestedCpuNanos: 0,
  requestedMemoryBytes: 0,
}
const dep: KubeDeployment = {
  name: 'web',
  namespace: 'apps',
  ready: '2/2',
  upToDate: 2,
  available: 2,
  createdAt: '2026-07-01T10:00:00Z',
}
const svc: KubeService = {
  name: 'web-svc',
  namespace: 'apps',
  type: 'ClusterIP',
  clusterIP: '10.1.0.1',
  ports: '80/TCP',
  createdAt: '2026-07-01T10:00:00Z',
}
const node: KubeNode = {
  name: 'node-1',
  status: 'Ready',
  roles: ['worker'],
  version: 'v1.29.2',
  schedulable: true,
  createdAt: '2026-07-01T10:00:00Z',
  allocatableCpuNanos: 0,
  allocatableMemoryBytes: 0,
}

const fake: ResourceKubernetesService = {
  listContexts: async () => ({ contexts: [ctx], current: 'prod' }),
  listNamespaces: async (): Promise<KubeNamespace[]> => [{ name: 'apps', phase: 'Active' }],
  listPods: async (): Promise<KubePod[]> => [pod],
  getPod: async (_namespace, name): Promise<KubePod | null> => (name === pod.name ? pod : null),
  listDeployments: async (): Promise<KubeDeployment[]> => [dep],
  listServices: async (): Promise<KubeService[]> => [svc],
  listNodes: async (): Promise<KubeNode[]> => [node],
  podLogs: async (namespace, p, opts): Promise<PodLogs> => ({
    pod: p,
    lines: `log for ${p} (tail ${opts.tail}, ctx ${opts.context})`,
  }),
  describePod: async (namespace, p): Promise<PodDescribe> => ({ pod: p, text: `Name: ${p}` }),
  podEvents: async (): Promise<KubeEvent[]> => [
    {
      type: 'Warning',
      reason: 'BackOff',
      message: 'restarting',
      count: 3,
      source: 'kubelet',
      lastSeen: '2026-07-01T10:05:00Z',
    },
  ],
  describeResource: async (kind, namespace, name): Promise<ResourceDescribe> => ({
    kind,
    name,
    text: `Describe ${kind} ${name}`,
  }),
  resourceEvents: async (): Promise<KubeEvent[]> => [
    {
      type: 'Normal',
      reason: 'ScalingReplicaSet',
      message: 'scaled up',
      count: 1,
      source: 'deployment-controller',
      lastSeen: '2026-07-01T10:05:00Z',
    },
  ],
  describeNode: async (name): Promise<PodDescribe> => ({ pod: name, text: `Node: ${name}` }),
  getManifest: async (kind, name, namespace, context): Promise<KubeManifest> => ({
    kind,
    name,
    namespace: namespace ?? '',
    yaml: `kind: ${kind}\nname: ${name}\nctx: ${context}`,
  }),
}

const provider = createKubernetesResourceProvider(fake)

describe('kubernetes resource provider', () => {
  test('roots = contexts', async () => {
    const roots = await provider.listChildren('u', null)
    expect(roots[0]).toMatchObject({
      uri: 'localix://resource/k8s/prod',
      label: 'prod',
      detail: 'current',
      hasChildren: true,
    })
  })

  test('context lists a Nodes folder + namespaces', async () => {
    const kids = await provider.listChildren('u', 'localix://resource/k8s/prod')
    expect(kids[0]).toMatchObject({ uri: 'localix://resource/k8s/prod/node', icon: 'k8s-node' })
    expect(kids.some((k) => k.uri === 'localix://resource/k8s/prod/apps')).toBe(true)
  })

  test('namespace lists deployments + services + pods', async () => {
    const kids = await provider.listChildren('u', 'localix://resource/k8s/prod/apps')
    expect(kids.map((k) => k.uri)).toEqual([
      'localix://resource/k8s/prod/apps/deployment/web',
      'localix://resource/k8s/prod/apps/service/web-svc',
      'localix://resource/k8s/prod/apps/web-1',
    ])
  })

  test('pod sections include manifest', async () => {
    const sections = await provider.listChildren('u', 'localix://resource/k8s/prod/apps/web-1')
    expect(sections.map((s) => s.uri)).toEqual([
      'localix://resource/k8s/prod/apps/web-1/logs',
      'localix://resource/k8s/prod/apps/web-1/describe',
      'localix://resource/k8s/prod/apps/web-1/events',
      'localix://resource/k8s/prod/apps/web-1/manifest',
    ])
  })

  test('workload sections = describe/events/manifest', async () => {
    const sections = await provider.listChildren(
      'u',
      'localix://resource/k8s/prod/apps/deployment/web',
    )
    expect(sections.map((s) => s.uri)).toEqual([
      'localix://resource/k8s/prod/apps/deployment/web/describe',
      'localix://resource/k8s/prod/apps/deployment/web/events',
      'localix://resource/k8s/prod/apps/deployment/web/manifest',
    ])
  })

  test('node folder + sections', async () => {
    const nodes = await provider.listChildren('u', 'localix://resource/k8s/prod/node')
    expect(nodes[0]?.uri).toBe('localix://resource/k8s/prod/node/node-1')
    const sections = await provider.listChildren('u', 'localix://resource/k8s/prod/node/node-1')
    expect(sections.map((s) => s.uri)).toEqual([
      'localix://resource/k8s/prod/node/node-1/describe',
      'localix://resource/k8s/prod/node/node-1/manifest',
    ])
  })

  test('expand logs threads ctx + tail; events render', async () => {
    const logs = await provider.expand('u', 'localix://resource/k8s/prod/apps/web-1/logs')
    expect(logs.content).toContain('tail 400, ctx prod')
    const events = await provider.expand('u', 'localix://resource/k8s/prod/apps/web-1/events')
    expect(events.content).toContain('BackOff')
  })

  test('refined logs thread the selected container and previous mode', async () => {
    const calls: Array<{ container?: string; previous?: boolean }> = []
    const refined = createKubernetesResourceProvider({
      ...fake,
      podLogs: async (_namespace, p, opts) => {
        calls.push({ container: opts.container, previous: opts.previous })
        return { pod: p, lines: 'previous output' }
      },
    })
    const result = await refined.expand(
      'u',
      'localix://resource/k8s/prod/apps/web-1/logs/container/web%2Fsidecar/previous',
    )
    expect(result.ok).toBe(true)
    expect(calls).toEqual([{ container: 'web/sidecar', previous: true }])
    expect(result.content).toContain('container web/sidecar, previous')
  })

  test('rejects malformed log refinements without calling Kubernetes', async () => {
    let calls = 0
    const refined = createKubernetesResourceProvider({
      ...fake,
      podLogs: async () => {
        calls += 1
        return { pod: 'web-1', lines: '' }
      },
    })
    expect(
      (
        await refined.expand(
          'u',
          'localix://resource/k8s/prod/apps/web-1/logs/not-container/web/previous',
        )
      ).ok,
    ).toBe(false)
    expect(calls).toBe(0)
  })

  test('pod summary; missing pod → error', async () => {
    expect(
      (await provider.expand('u', 'localix://resource/k8s/prod/apps/web-1')).content,
    ).toContain('Pod "web-1"')
    expect((await provider.expand('u', 'localix://resource/k8s/prod/apps/ghost')).ok).toBe(false)
  })

  test('manifest expansions carry the yaml language hint', async () => {
    const podManifest = await provider.expand(
      'u',
      'localix://resource/k8s/prod/apps/web-1/manifest',
    )
    expect(podManifest).toMatchObject({ ok: true, language: 'yaml' })
    expect(podManifest.content).toContain('kind: pod')
    const depManifest = await provider.expand(
      'u',
      'localix://resource/k8s/prod/apps/deployment/web/manifest',
    )
    expect(depManifest).toMatchObject({ ok: true, language: 'yaml' })
    expect(depManifest.content).toContain('kind: deployment')
    const nodeManifest = await provider.expand(
      'u',
      'localix://resource/k8s/prod/node/node-1/manifest',
    )
    expect(nodeManifest).toMatchObject({ ok: true, language: 'yaml' })
    expect(nodeManifest.content).toContain('kind: node')
  })

  test('workload + node describe expand', async () => {
    expect(
      (await provider.expand('u', 'localix://resource/k8s/prod/apps/deployment/web')).content,
    ).toContain('Describe deployment web')
    expect(
      (await provider.expand('u', 'localix://resource/k8s/prod/apps/service/web-svc/events'))
        .content,
    ).toContain('ScalingReplicaSet')
    expect(
      (await provider.expand('u', 'localix://resource/k8s/prod/node/node-1')).content,
    ).toContain('Node: node-1')
  })

  test('percent-encodes an arbitrary kube context and decodes it for service calls', async () => {
    const calls: string[] = []
    const awkwardContext = 'dev west/team'
    const awkward = createKubernetesResourceProvider({
      ...fake,
      listContexts: async () => ({
        contexts: [{ ...ctx, name: awkwardContext }],
        current: awkwardContext,
      }),
      listNamespaces: async (context) => {
        calls.push(context ?? '')
        return [{ name: 'apps', phase: 'Active' }]
      },
      listPods: async (namespace, context) => {
        calls.push(`${context}:${namespace}`)
        return [pod]
      },
      getPod: async (namespace, name, context) => {
        calls.push(`${context}:${namespace}:${name}`)
        return name === pod.name ? pod : null
      },
    })

    const roots = await awkward.listChildren('u', null)
    expect(roots[0]?.uri).toBe('localix://resource/k8s/dev%20west%2Fteam')
    expect(roots[0]?.uri).not.toContain(' ')

    const namespaces = await awkward.listChildren('u', roots[0]!.uri)
    expect(
      namespaces.some(({ uri }) => uri === 'localix://resource/k8s/dev%20west%2Fteam/apps'),
    ).toBe(true)
    const pods = await awkward.listChildren('u', 'localix://resource/k8s/dev%20west%2Fteam/apps')
    expect(
      pods.some(({ uri }) => uri === 'localix://resource/k8s/dev%20west%2Fteam/apps/web-1'),
    ).toBe(true)
    const summary = await awkward.expand('u', 'localix://resource/k8s/dev%20west%2Fteam/apps/web-1')
    expect(summary.ok).toBe(true)
    expect(calls).toEqual([
      awkwardContext,
      `${awkwardContext}:apps`,
      `${awkwardContext}:apps:web-1`,
    ])
  })

  test('keeps real namespace and pod names distinct from URI grammar markers', async () => {
    const markerPod = { ...pod, name: 'deployment', namespace: 'node' }
    const markerNames = createKubernetesResourceProvider({
      ...fake,
      listNamespaces: async () => [{ name: 'node', phase: 'Active' }],
      listPods: async (namespace) => (namespace === 'node' ? [markerPod] : []),
      listDeployments: async () => [],
      listServices: async () => [],
      getPod: async (namespace, name) =>
        namespace === 'node' && name === 'deployment' ? markerPod : null,
    })

    const contextChildren = await markerNames.listChildren('u', 'localix://resource/k8s/prod')
    expect(contextChildren.map(({ uri }) => uri)).toEqual([
      'localix://resource/k8s/prod/node',
      'localix://resource/k8s/prod/%6Eode',
    ])

    const namespaceChildren = await markerNames.listChildren(
      'u',
      'localix://resource/k8s/prod/%6Eode',
    )
    expect(namespaceChildren.map(({ uri }) => uri)).toEqual([
      'localix://resource/k8s/prod/%6Eode/%64eployment',
    ])
    const podSections = await markerNames.listChildren(
      'u',
      'localix://resource/k8s/prod/%6Eode/%64eployment',
    )
    expect(podSections[0]?.uri).toBe('localix://resource/k8s/prod/%6Eode/%64eployment/logs')
    expect(
      (await markerNames.expand('u', 'localix://resource/k8s/prod/%6Eode/%64eployment')).content,
    ).toContain('Pod "deployment"')
  })

  test('an unreachable cluster is a classified notice, never an empty namespace list', async () => {
    const raw = 'Unable to connect to the server: dial tcp 10.0.0.1:6443: i/o timeout'
    const down = createKubernetesResourceProvider({
      ...fake,
      listNamespaces: async () => {
        throw new Error(raw)
      },
    })

    const nodes = await down.listChildren('u', 'localix://resource/k8s/prod')
    expect(nodes).toEqual([
      {
        uri: 'localix://resource/k8s/prod#notice',
        label: 'Cannot reach this cluster right now.',
        detail: raw,
        hasChildren: false,
        notice: true,
      },
    ])

    // Never `ok: true` with "0 namespaces" — that reads to the model as an empty cluster.
    const res = await down.expand('u', 'localix://resource/k8s/prod')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Cannot reach this cluster right now.')
  })
})
