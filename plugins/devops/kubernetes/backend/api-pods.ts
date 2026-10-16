/** Pod-scoped API operations: listing, reading, logs, describe, events, delete. */
import type { KubernetesBackend } from './backend-port'
import { mergeContainerLogs, podContainerNames } from './log-merge'
import { mapKubeError } from './errors'
import { parsePod, parsePods } from './parse'
import {
  allNamespaces,
  call,
  clients,
  describe,
  events,
  json,
  metricsTarget,
} from './api-internals'
import { fetchPodMetrics } from './api-metrics'

type PodOperations = Pick<
  KubernetesBackend,
  'listPods' | 'getPod' | 'podMetrics' | 'podLogs' | 'describePod' | 'deletePod' | 'podEvents'
>

export function createPodOperations(): PodOperations {
  return {
    async listPods(namespace, context) {
      return call(async () => {
        const { core } = await clients(context)
        const result = allNamespaces(namespace)
          ? await core.listPodForAllNamespaces()
          : await core.listNamespacedPod({ namespace })
        return parsePods(json(result))
      })
    },
    async getPod(namespace, name, context) {
      try {
        const result = await (await clients(context)).core.readNamespacedPod({ name, namespace })
        return parsePod(json(result))
      } catch (error) {
        const mapped = mapKubeError(error)
        if (mapped.code === 'not_found') return null
        throw mapped
      }
    },
    // Metrics deliberately do NOT go through `call()`: its job is to map a cluster
    // failure onto a typed KubeError, and here a failure is the ANSWER (`null`), not an
    // error to raise. Even an unusable context resolves to "no usage available".
    async podMetrics(namespace, context) {
      const target = await metricsTarget(context)
      if (!target) return null
      return (await fetchPodMetrics(target.cacheKey, namespace, target.fetchJson)).pods
    },
    async podLogs(namespace, pod, options) {
      return call(async () => {
        const { core } = await clients(options.context)
        const read = (container?: string) =>
          core.readNamespacedPodLog({
            name: pod,
            namespace,
            container,
            follow: false,
            previous: options.previous,
            sinceSeconds: options.sinceSeconds,
            tailLines: options.tail,
            // Always stamped: the timestamps are what makes an all-containers merge
            // orderable, and the UI strips them for display either way.
            timestamps: true,
          })

        // Naming a container is the more specific ask, so it wins over all-containers.
        if (options.container || !options.allContainers)
          return { pod, lines: await read(options.container) }

        const target = await core.readNamespacedPod({ name: pod, namespace })
        const names = podContainerNames(target as unknown as Record<string, unknown>)
        if (names.length <= 1) return { pod, lines: await read(names[0]) }

        // One request per container, in parallel. A container that cannot serve logs (an
        // init container that never started, a terminated one whose logs were rotated
        // away) contributes an empty stream instead of failing the whole read — the other
        // containers are still the answer the user asked for.
        const streams = await Promise.all(
          names.map(async (container) => ({
            container,
            lines: await read(container).catch(() => ''),
          })),
        )
        return { pod, lines: mergeContainerLogs(streams) }
      })
    },
    async describePod(namespace, pod, context) {
      return call(async () => {
        const value = await (
          await clients(context)
        ).core.readNamespacedPod({
          name: pod,
          namespace,
        })
        return { pod, text: describe(value) }
      })
    },
    async deletePod(namespace, pod, context) {
      await call(async () =>
        (await clients(context)).core.deleteNamespacedPod({ name: pod, namespace }),
      )
    },
    async podEvents(namespace, pod, context) {
      return call(async () => events((await clients(context)).core, namespace, pod, 'Pod'))
    },
  }
}
