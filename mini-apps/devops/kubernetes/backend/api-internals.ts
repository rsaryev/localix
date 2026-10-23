/**
 * The pieces every API-backed resource group needs: a cached kubeconfig, typed
 * clients, error mapping, describe/manifest shaping, and discovery/metrics
 * targets.
 *
 * Kept apart from the resource groups (`api-pods`, `api-workloads`,
 * `api-cluster`, `api-manifests`) so a group module stays about its own
 * resource, and so the shape of "how we talk to a cluster" has exactly one
 * definition.
 */
import type * as k8s from '@kubernetes/client-node'
import { stringify } from 'yaml'
import { toolPath } from '@localixai/mini-app-sdk/backend'
import { createBunApiClient, createBunObjectApi, kubernetesFetch } from './api-http'
import { type ClusterResources, type FetchClusterJson, getClusterResources } from './api-discovery'
import { ALL_NAMESPACES, type KubeManifestKind } from './contracts'
import { KubeError, mapKubeError } from './errors'
import { getKubernetesClient } from './kubernetes-client'
import { parseEvents } from './parse'

export const FIELD_MANAGER = 'localix-kubernetes'
/** Row cap for a generic list: enough for a table page, small enough to stay a cheap tool result. */
export const DEFAULT_GENERIC_LIMIT = 200
export const json = (value: unknown) => JSON.stringify(value)

export interface Clients {
  config: k8s.KubeConfig
  core: k8s.CoreV1Api
  apps: k8s.AppsV1Api
}

const CONFIG_TTL_MS = 60_000
const configCache = new Map<string, { config: k8s.KubeConfig; loadedAt: number }>()

/**
 * Give every `exec` credential helper the CURRENT PATH.
 *
 * client-node spawns the helper with `process.env` only when the kubeconfig sets `exec.env`;
 * otherwise it passes no env, and under Bun the lookup then uses the PATH the process started with
 * — launchd's bare one in the packaged app. `gke-gcloud-auth-plugin` in Homebrew's bin was then
 * "not found" on a machine where `kubectl` worked. An explicit PATH entry makes client-node build
 * `{ ...process.env, PATH }`; a PATH the kubeconfig already sets is left alone.
 */
function withToolPathForExec(config: k8s.KubeConfig): void {
  for (const user of config.getUsers()) {
    const exec = user.exec as { env?: Array<{ name: string; value: string }> } | undefined
    if (!exec) continue
    const env = exec.env ?? []
    if (env.some((entry) => entry.name === 'PATH')) continue
    exec.env = [...env, { name: 'PATH', value: toolPath() }]
  }
}

export async function createKubeConfig(context?: string, fresh = false): Promise<k8s.KubeConfig> {
  const k8s = await getKubernetesClient()
  const key = context ?? ''
  const cached = configCache.get(key)
  if (!fresh && cached && Date.now() - cached.loadedAt < CONFIG_TTL_MS) return cached.config
  try {
    const config = new k8s.KubeConfig()
    config.loadFromDefault()
    withToolPathForExec(config)
    if (context) {
      if (!config.getContextObject(context)) {
        throw new KubeError('invalid_context', `Context "${context}" does not exist`)
      }
      config.setCurrentContext(context)
    }
    if (!config.getCurrentCluster()) {
      throw new KubeError(
        config.getCurrentContext() ? 'invalid_context' : 'no_kubeconfig',
        'The current kubeconfig context has no cluster',
      )
    }
    configCache.set(key, { config, loadedAt: Date.now() })
    return config
  } catch (error) {
    throw mapKubeError(error)
  }
}

export async function clients(context?: string): Promise<Clients> {
  const k8s = await getKubernetesClient()
  const config = await createKubeConfig(context)
  return {
    config,
    core: await createBunApiClient(config, k8s.CoreV1Api),
    apps: await createBunApiClient(config, k8s.AppsV1Api),
  }
}

export async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw mapKubeError(error)
  }
}

export function allNamespaces(namespace: string): boolean {
  return namespace === ALL_NAMESPACES
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : ''
}

export function describe(value: unknown): string {
  const object = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const metadata =
    object.metadata && typeof object.metadata === 'object'
      ? (object.metadata as Record<string, unknown>)
      : {}
  return [
    `Name:        ${text(metadata.name)}`,
    `Namespace:   ${text(metadata.namespace)}`,
    `Kind:        ${text(object.kind)}`,
    `API Version: ${text(object.apiVersion)}`,
    '',
    stringify(value, { lineWidth: 0 }).trimEnd(),
  ].join('\n')
}

export function cleanManifest(value: unknown): k8s.KubernetesObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new KubeError('manifest_apply_failed', 'Manifest must be a Kubernetes object')
  }
  const object = structuredClone(value) as Record<string, unknown>
  const metadata =
    object.metadata && typeof object.metadata === 'object'
      ? (object.metadata as Record<string, unknown>)
      : {}
  for (const key of [
    'creationTimestamp',
    'deletionGracePeriodSeconds',
    'deletionTimestamp',
    'generation',
    'managedFields',
    'resourceVersion',
    'selfLink',
    'uid',
  ]) {
    delete metadata[key]
  }
  delete object.status
  if (
    typeof object.apiVersion !== 'string' ||
    typeof object.kind !== 'string' ||
    typeof metadata.name !== 'string'
  ) {
    throw new KubeError(
      'manifest_apply_failed',
      'Manifest requires apiVersion, kind, and metadata.name',
    )
  }
  object.metadata = metadata
  return object as unknown as k8s.KubernetesObject
}

export async function events(core: k8s.CoreV1Api, namespace: string, name: string, kind: string) {
  const result = await core.listNamespacedEvent({
    namespace,
    fieldSelector: `involvedObject.name=${name},involvedObject.kind=${kind}`,
  })
  return parseEvents(json(result))
}

export async function patchObject(
  config: k8s.KubeConfig,
  object: k8s.KubernetesObject & Record<string, unknown>,
  strategy: k8s.PatchStrategy,
  dryRun?: string,
): Promise<void> {
  const api = await createBunObjectApi(config)
  await api.patch(object, undefined, dryRun, FIELD_MANAGER, undefined, strategy)
}

export async function readManifest(
  kind: KubeManifestKind,
  name: string,
  namespace: string | undefined,
  api: Clients,
): Promise<unknown> {
  if (kind === 'node') return api.core.readNode({ name })
  if (!namespace) throw new KubeError('not_found', `${kind}/${name} has no namespace`)
  if (kind === 'pod') return api.core.readNamespacedPod({ name, namespace })
  if (kind === 'service') return api.core.readNamespacedService({ name, namespace })
  return api.apps.readNamespacedDeployment({ name, namespace })
}

/**
 * A JSON GET against the cluster the given config points at, for discovery.
 *
 * Discovery endpoints have no typed client method worth the indirection (`/apis/<gv>` would mean one
 * generated class per group), and `kubernetesFetch` already carries the TLS/auth the rest of the
 * mini app uses. Non-2xx becomes a rejection so `discoverClusterResources` records the
 * group-version as unavailable rather than parsing an error body as a resource list.
 */
export function clusterJsonFetcher(config: k8s.KubeConfig): FetchClusterJson {
  const server = config.getCurrentCluster()?.server
  if (!server) throw new KubeError('invalid_context', 'No active Kubernetes cluster')
  const base = server.replace(/\/+$/, '')
  return async (path) => {
    const response = await kubernetesFetch(config, `${base}${path}`)
    if (!response.ok) throw new Error(`${response.status} ${path}`)
    return response.json()
  }
}

/**
 * The metrics fetcher for a context, or `null` when no cluster can be selected at all.
 *
 * Keyed by exactly what selected the config, like discovery — two clusters report
 * different numbers and answering with the wrong cluster's usage is worse than blank.
 */
export async function metricsTarget(
  context?: string,
): Promise<{ fetchJson: FetchClusterJson; cacheKey: string } | null> {
  try {
    return {
      fetchJson: clusterJsonFetcher(await createKubeConfig(context)),
      cacheKey: context ?? '',
    }
  } catch {
    return null
  }
}

/** Discovery is cached per context, so the cache key must be exactly what selected the config. */
export async function discoverFor(context?: string): Promise<ClusterResources> {
  const config = await createKubeConfig(context)
  return getClusterResources(context ?? '', clusterJsonFetcher(config))
}
