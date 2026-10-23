/**
 * KUBERNETES search provider (agent-core search) — matches pod names in the CURRENT
 * kubeconfig context (across a bounded set of namespaces). `lazy`: it queries a
 * remote API, so it runs ONLY when the Kubernetes scope is explicitly selected. Hit
 * ids are `localix://resource/k8s/<context>/<namespace>/<pod>` so a result opens the
 * pod tab.
 *
 * WHY IT ANSWERS `{ hits, problem }`. This provider has four ways to come back empty
 * and only one of them means "no pod matched": no kubeconfig, an unreachable API
 * server, RBAC refusing the namespace list, a namespace whose pods could not be read.
 * All four used to be `[]`, which is the same answer a healthy cluster gives for a
 * typo — so the person searching was told their pod does not exist by a cluster they
 * were never connected to. Each is now a sentence, and the partial results (namespaces
 * that DID answer) stay on screen beside it.
 *
 * The sentences come from `mapKubeError`, which already owns this workbench's
 * client-error→code vocabulary; `toErrorInfo` puts the friendly one in `message` and
 * keeps the client's raw text in `detail`.
 */
import type {
  Problem,
  SearchHit,
  SearchProvider,
  SearchProviderResult,
} from '@localixai/mini-app-sdk/backend'
import { bestFieldScore } from '@localixai/mini-app-sdk/backend'
import { KubeError, mapKubeError, toErrorInfo } from './errors'
import { podUri } from './resource-nodes'

export interface KubeContextsResult {
  current: string
  contexts: Array<{ name: string }>
}
export interface KubePodRow {
  name: string
  namespace: string
}

export interface KubernetesSearchPort {
  listContexts(): Promise<KubeContextsResult>
  listNamespaces(context?: string): Promise<Array<{ name: string }>>
  listPods(namespace: string, context?: string): Promise<KubePodRow[]>
}

/** Bound namespace fan-out so a large cluster cannot trigger dozens of API lists. */
const MAX_NAMESPACES = 12

export function createKubernetesSearchProvider(port: KubernetesSearchPort): SearchProvider {
  return {
    id: 'devops:kubernetes-search',
    title: 'Kubernetes',
    tier: 'lazy',
    icon: 'k8s',
    async search(_userId, query): Promise<SearchProviderResult> {
      let contextsError: unknown
      const ctxs = await port.listContexts().catch((err: unknown) => {
        contextsError = err
        return null
      })
      const context = ctxs?.current || ctxs?.contexts[0]?.name
      // No context is not an empty cluster — either the lookup threw, or nothing is
      // configured. The second has no thrown value to classify, so the code is stated
      // rather than pattern-matched out of a message this file would have to invent.
      if (!context) {
        return {
          hits: [],
          problem: problemFrom(contextsError ?? new KubeError('no_kubeconfig')),
        }
      }
      let namespacesError: unknown
      const namespaces = await port.listNamespaces(context).catch((err: unknown) => {
        namespacesError = err
        return [] as Array<{ name: string }>
      })
      let podsError: unknown
      const podLists = await Promise.all(
        namespaces.slice(0, MAX_NAMESPACES).map((ns) =>
          port.listPods(ns.name, context).catch((err: unknown) => {
            // One unreadable namespace out of twelve must not erase the eleven that
            // answered, so it is remembered rather than thrown — but it is remembered.
            podsError ??= err
            return [] as KubePodRow[]
          }),
        ),
      )
      const hits: SearchHit[] = []
      for (const pods of podLists) {
        for (const p of pods) {
          const score = bestFieldScore([p.name], query.text)
          if (score <= 0) continue
          hits.push({
            id: podUri(context, p.namespace, p.name),
            domain: 'devops:kubernetes-search',
            title: p.name,
            subtitle: p.namespace,
            icon: 'k8s-pod',
            score,
          })
        }
      }
      // Namespaces first: when the list itself failed there are no pods to speak of,
      // and a per-namespace read error is a consequence of the same outage.
      const failure = namespacesError ?? podsError
      return { hits, ...(failure ? { problem: problemFrom(failure) } : {}) }
    },
  }
}

/** A thrown client error as the product's three slots: code, sentence, raw text. */
function problemFrom(err: unknown): Problem {
  const info = toErrorInfo(mapKubeError(err))
  return { field: info.code, message: info.message, detail: info.detail }
}
