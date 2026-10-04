/** Manifest read/apply: the YAML round-trip a resource tab's Manifest view uses. */
import { parse, stringify } from 'yaml'
import type { KubernetesBackend } from './backend-port'
import { createBunObjectApi } from './api-http'
import { KubeError, mapKubeError } from './errors'
import { getKubernetesClient } from './kubernetes-client'
import { FIELD_MANAGER, call, cleanManifest, clients, readManifest } from './api-internals'

type ManifestOperations = Pick<KubernetesBackend, 'getManifest' | 'applyManifest'>

export function createManifestOperations(): ManifestOperations {
  return {
    async getManifest(kind, name, namespace, context) {
      return call(async () => ({
        kind,
        name,
        namespace: kind === 'node' ? '' : (namespace ?? ''),
        yaml: stringify(await readManifest(kind, name, namespace, await clients(context)), {
          lineWidth: 0,
        }),
      }))
    },
    async applyManifest(source, context) {
      try {
        const k8s = await getKubernetesClient()
        const api = await createBunObjectApi((await clients(context)).config)
        const manifest = cleanManifest(parse(source))
        await api.patch(
          manifest,
          undefined,
          'All',
          FIELD_MANAGER,
          false,
          k8s.PatchStrategy.ServerSideApply,
        )
        await api.patch(
          manifest,
          undefined,
          undefined,
          FIELD_MANAGER,
          false,
          k8s.PatchStrategy.ServerSideApply,
        )
        return { output: `${manifest.kind}/${manifest.metadata?.name} configured` }
      } catch (error) {
        const mapped = mapKubeError(error)
        throw new KubeError('manifest_apply_failed', mapped.message, { cause: error })
      }
    },
  }
}
