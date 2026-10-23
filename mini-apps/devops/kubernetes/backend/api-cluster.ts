/** Cluster-scoped operations: contexts, namespaces, nodes, and node lifecycle. */
import type * as k8s from '@kubernetes/client-node'
import type { KubernetesBackend } from './backend-port'
import { fetchNodeMetrics } from './api-metrics'
import { KubeError, mapKubeError } from './errors'
import { getKubernetesClient } from './kubernetes-client'
import { parseNamespaces, parseNodes } from './parse'
import {
  type Clients,
  call,
  clients,
  createKubeConfig,
  describe,
  json,
  metricsTarget,
  patchObject,
} from './api-internals'

type ClusterOperations = Pick<
  KubernetesBackend,
  | 'listContexts'
  | 'listNamespaces'
  | 'listNodes'
  | 'nodeMetrics'
  | 'cordonNode'
  | 'uncordonNode'
  | 'drainNode'
  | 'describeNode'
>

/** How long a drain keeps evicting before it reports the remaining pods as a timeout. */
const DRAIN_TIMEOUT_MS = 120_000
/** Pause between bounded eviction passes, so a PDB rejection is retried rather than spun on. */
const DRAIN_PASS_INTERVAL_MS = 1000

async function setUnschedulable(api: Clients, name: string, unschedulable: boolean) {
  const k8s = await getKubernetesClient()
  await patchObject(
    api.config,
    {
      apiVersion: 'v1',
      kind: 'Node',
      metadata: { name },
      spec: { unschedulable },
    },
    k8s.PatchStrategy.MergePatch,
  )
}

/** Pods a drain leaves alone: already finished, static/mirror, or DaemonSet-owned. */
function skipDuringDrain(pod: k8s.V1Pod): boolean {
  const phase = pod.status?.phase
  if (phase === 'Succeeded' || phase === 'Failed') return true
  if (pod.metadata?.annotations?.['kubernetes.io/config.mirror']) return true
  return pod.metadata?.ownerReferences?.some((owner) => owner.kind === 'DaemonSet') ?? false
}

export function createClusterOperations(): ClusterOperations {
  return {
    async listContexts() {
      const config = await createKubeConfig(undefined, true)
      const current = config.getCurrentContext()
      return {
        current,
        contexts: config.getContexts().map((context) => ({
          name: context.name,
          cluster: context.cluster,
          namespace: context.namespace ?? '',
          current: context.name === current,
        })),
      }
    },
    async listNamespaces(context) {
      return call(async () =>
        parseNamespaces(json(await (await clients(context)).core.listNamespace())),
      )
    },
    async listNodes(context) {
      return call(async () => parseNodes(json(await (await clients(context)).core.listNode())))
    },
    // Metrics deliberately do NOT go through `call()`: a failure is the ANSWER (`null`),
    // not an error to raise. Even an unusable context resolves to "no usage available".
    async nodeMetrics(context) {
      const target = await metricsTarget(context)
      if (!target) return null
      return (await fetchNodeMetrics(target.cacheKey, target.fetchJson)).nodes
    },
    async cordonNode(name, context) {
      await call(async () => setUnschedulable(await clients(context), name, true))
    },
    async uncordonNode(name, context) {
      await call(async () => setUnschedulable(await clients(context), name, false))
    },
    async drainNode(name, context) {
      await call(async () => {
        const api = await clients(context)
        const { core } = api
        await setUnschedulable(api, name, true)
        const deadline = Date.now() + DRAIN_TIMEOUT_MS
        for (;;) {
          const listed = await core.listPodForAllNamespaces({
            fieldSelector: `spec.nodeName=${name}`,
          })
          const pods = listed.items.filter((pod) => !skipDuringDrain(pod))
          if (pods.length === 0) return
          if (Date.now() >= deadline) {
            throw new KubeError(
              'command_timeout',
              `Timed out draining ${name}; ${pods.length} pod(s) remain`,
            )
          }
          for (const pod of pods) {
            const podName = pod.metadata?.name
            const namespace = pod.metadata?.namespace
            if (!podName || !namespace) continue
            try {
              // oxlint-disable-next-line react-doctor/async-await-in-loop -- drain evictions stay ordered so a hard API failure stops before more workloads are disrupted; PDB rejections are retried on the next bounded pass
              await core.createNamespacedPodEviction({
                name: podName,
                namespace,
                body: {
                  apiVersion: 'policy/v1',
                  kind: 'Eviction',
                  metadata: { name: podName, namespace },
                },
              })
            } catch (error) {
              const mapped = mapKubeError(error)
              const detail = `${mapped.message} ${mapped.friendly}`.toLowerCase()
              if (mapped.code !== 'not_found' && !detail.includes('budget')) {
                throw mapped
              }
            }
          }
          await Bun.sleep(DRAIN_PASS_INTERVAL_MS)
        }
      })
    },
    async describeNode(name, context) {
      return call(async () => {
        const value = await (await clients(context)).core.readNode({ name })
        return { pod: name, text: describe(value) }
      })
    },
  }
}
