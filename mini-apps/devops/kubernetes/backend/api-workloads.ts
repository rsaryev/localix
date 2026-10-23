/** Deployment / service operations, plus the discovery-driven generic list. */
import type { KubernetesBackend } from './backend-port'
import { createBunObjectApi } from './api-http'
import type { KubeResourceKind } from './contracts'
import {
  type GenericRow,
  listableResources,
  normalizeGenericRow,
  resolveResource,
} from './discovery'
import { getKubernetesClient } from './kubernetes-client'
import {
  buildLabelSelector,
  parseDeployments,
  parseDeploymentSelector,
  parsePods,
  parseServices,
} from './parse'
import {
  DEFAULT_GENERIC_LIMIT,
  allNamespaces,
  call,
  clients,
  createKubeConfig,
  describe,
  discoverFor,
  events,
  json,
  patchObject,
  readManifest,
} from './api-internals'

type WorkloadOperations = Pick<
  KubernetesBackend,
  | 'listApiResources'
  | 'listByKind'
  | 'listDeployments'
  | 'listServices'
  | 'listDeploymentPods'
  | 'restartDeployment'
  | 'scaleDeployment'
  | 'describeResource'
  | 'resourceEvents'
>

const isRow = (row: GenericRow | null): row is GenericRow => row !== null

export function createWorkloadOperations(): WorkloadOperations {
  return {
    async listApiResources(context) {
      return call(async () => {
        const { resources, unavailable } = await discoverFor(context)
        return {
          resources: listableResources(resources).map(
            ({ apiVersion, kind, plural, namespaced }) => ({
              apiVersion,
              kind,
              plural,
              namespaced,
            }),
          ),
          unavailable,
        }
      })
    },
    async listByKind(kind, namespace, opts) {
      return call(async () => {
        const { resources } = await discoverFor(opts?.context)
        const target = resolveResource(resources, kind)
        // Unknown kind is a normal answer (a CRD that is not installed), not a transport error.
        if (!target) return null

        const limit = opts?.limit ?? DEFAULT_GENERIC_LIMIT
        const config = await createKubeConfig(opts?.context)
        // Cluster-scoped kinds must get NO namespace — sending one produces a 404 for a resource
        // that exists. ALL_NAMESPACES is the same "omit it" instruction for a namespaced kind.
        const scope =
          target.namespaced && namespace && !allNamespaces(namespace) ? namespace : undefined
        const api = await createBunObjectApi(config)
        const result = await api.list(
          target.apiVersion,
          target.kind,
          scope,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          // Ask for one more than we return: the extra row is how we know the list was cut short
          // without a second request. `metadata.continue` is only set by some servers.
          limit + 1,
        )
        const items = Array.isArray(result?.items) ? result.items : []
        const rows: GenericRow[] = []
        for (const item of items.slice(0, limit)) {
          const row = normalizeGenericRow(item)
          if (isRow(row)) rows.push(row)
        }
        return {
          apiVersion: target.apiVersion,
          kind: target.kind,
          namespaced: target.namespaced,
          rows,
          truncated: items.length > limit,
        }
      })
    },
    async listDeployments(namespace, context) {
      return call(async () => {
        const { apps } = await clients(context)
        const result = allNamespaces(namespace)
          ? await apps.listDeploymentForAllNamespaces()
          : await apps.listNamespacedDeployment({ namespace })
        return parseDeployments(json(result))
      })
    },
    async listServices(namespace, context) {
      return call(async () => {
        const { core } = await clients(context)
        const result = allNamespaces(namespace)
          ? await core.listServiceForAllNamespaces()
          : await core.listNamespacedService({ namespace })
        return parseServices(json(result))
      })
    },
    async listDeploymentPods(namespace, name, context) {
      return call(async () => {
        const api = await clients(context)
        const deployment = await api.apps.readNamespacedDeployment({ name, namespace })
        const selector = buildLabelSelector(parseDeploymentSelector(json(deployment)))
        if (!selector) return []
        const pods = await api.core.listNamespacedPod({
          namespace,
          labelSelector: selector,
        })
        return parsePods(json(pods))
      })
    },
    async restartDeployment(namespace, name, context) {
      await call(async () => {
        const k8s = await getKubernetesClient()
        return patchObject(
          (await clients(context)).config,
          {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name, namespace },
            spec: {
              template: {
                metadata: {
                  annotations: {
                    'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
                  },
                },
              },
            },
          },
          k8s.PatchStrategy.StrategicMergePatch,
        )
      })
    },
    async scaleDeployment(namespace, name, replicas, context) {
      await call(async () => {
        const k8s = await getKubernetesClient()
        return patchObject(
          (await clients(context)).config,
          {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name, namespace },
            spec: { replicas },
          },
          k8s.PatchStrategy.MergePatch,
        )
      })
    },
    async describeResource(kind, namespace, name, context) {
      return call(async () => {
        const value = await readManifest(kind, name, namespace, await clients(context))
        return { kind, name, text: describe(value) }
      })
    },
    async resourceEvents(kind, namespace, name, context) {
      const objectKind: Record<KubeResourceKind, string> = {
        deployment: 'Deployment',
        service: 'Service',
      }
      return call(async () =>
        events((await clients(context)).core, namespace, name, objectKind[kind]),
      )
    },
  }
}
