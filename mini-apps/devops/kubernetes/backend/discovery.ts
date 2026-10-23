/**
 * API DISCOVERY: turn what the cluster SAYS it serves into a resolvable table of kinds.
 *
 * Every list in this mini app used to name its kind in TypeScript — `listPods`, `listDeployments`,
 * `listServices`, `listNodes` — so the workbench could show exactly four things and the agent's
 * `kubernetes_get` could list exactly one (pods). A cluster serves dozens out of the box and an
 * arbitrary number of CRDs, and the code that talks to them is already generic:
 * `createBunObjectApi()` is `k8s.KubernetesObjectApi`, which addresses any object by
 * `apiVersion` + `kind`, and `applyManifest` has always used it to server-side-apply ANY manifest.
 * The missing half was never the transport — it was knowing that `certificates` means
 * `cert-manager.io/v1` `Certificate`, and whether it is namespaced.
 *
 * That is what `kubectl` does before every command (`/api/v1`, `/apis`, then `/apis/<group>/<version>`)
 * and what jet-pilot (MIT) reproduces to render any resource generically. This module is the pure
 * half: parse those three response shapes, and resolve a human's word to one entry.
 *
 * Deliberately NOT a full discovery client: no aggregated-API health checks, no OpenAPI schema
 * fetch. The one question is "which apiVersion+kind does this word mean, and is it namespaced".
 */

/** One resource the cluster serves, normalized from `V1APIResource` + its group-version. */
export interface DiscoveredResource {
  /** `apiVersion` in the form the object API wants: `v1` for core, else `group/version`. */
  apiVersion: string
  /** Kind, as the API reports it (`Pod`, `Deployment`, `Certificate`). */
  kind: string
  /** Plural resource name used in URLs (`pods`, `certificates`). */
  plural: string
  /** Singular name when the API reports one (`pod`); may be empty. */
  singular: string
  /** Short names (`po`, `deploy`, `svc`). */
  shortNames: string[]
  /** Namespaced resources need a namespace; cluster-scoped ones must NOT get one. */
  namespaced: boolean
  /** Verbs the API allows. A resource without `list` cannot back a table. */
  verbs: string[]
}

/** Raw `V1APIResourceList` fields this module reads. Structural on purpose — no client import. */
interface RawApiResource {
  name?: unknown
  singularName?: unknown
  kind?: unknown
  namespaced?: unknown
  shortNames?: unknown
  verbs?: unknown
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/**
 * Parse one `/api/v1` or `/apis/<group>/<version>` response into resources.
 *
 * SUBRESOURCES ARE DROPPED. The API lists `pods/log`, `pods/exec`, `deployments/scale` in the same
 * array as `pods` — they are operations on an object, not listable kinds, and a table built from one
 * would be empty at best. `kubectl api-resources` filters them the same way (a `/` in the name).
 */
export function parseApiResourceList(apiVersion: string, body: unknown): DiscoveredResource[] {
  const resources = (body as { resources?: unknown } | null)?.resources
  if (!Array.isArray(resources)) return []
  const out: DiscoveredResource[] = []
  for (const entry of resources as RawApiResource[]) {
    const plural = asString(entry?.name)
    const kind = asString(entry?.kind)
    if (!plural || !kind || plural.includes('/')) continue
    out.push({
      apiVersion,
      kind,
      plural,
      singular: asString(entry?.singularName),
      shortNames: asStringArray(entry?.shortNames),
      namespaced: entry?.namespaced === true,
      verbs: asStringArray(entry?.verbs),
    })
  }
  return out
}

/**
 * The group-versions to ask, from an `/apis` (`V1APIGroupList`) response.
 *
 * PREFERRED VERSION ONLY. A group commonly serves `v1` and `v1beta1` of the same kind; asking every
 * version would list `Certificate` three times and leave the caller to guess. The API tells us which
 * one it prefers, and that is the one `kubectl` uses.
 */
export function preferredGroupVersions(body: unknown): string[] {
  const groups = (body as { groups?: unknown } | null)?.groups
  if (!Array.isArray(groups)) return []
  const out: string[] = []
  for (const group of groups as Array<{ preferredVersion?: { groupVersion?: unknown } }>) {
    const gv = asString(group?.preferredVersion?.groupVersion)
    if (gv) out.push(gv)
  }
  return out
}

/** Lowercased, trimmed — every match in `resolveResource` is case-insensitive. */
const norm = (value: string): string => value.trim().toLowerCase()

/**
 * Resolve a human's word to one discovered resource, or null.
 *
 * Match order is specificity, not convenience: an exact `group/plural` (`certificates.cert-manager.io`
 * style disambiguation), then plural, then kind, then singular, then short name. Without the ordering
 * a cluster with two groups serving `Certificate` would resolve by whichever came back first, which
 * changes between clusters — the caller would see a different resource on a different machine and
 * nothing would explain why.
 *
 * Only resources the API says it can `list` are candidates: resolving to something unlistable and
 * failing at request time would report a transport error for what is really "that is not a table".
 */
export function resolveResource(
  resources: readonly DiscoveredResource[],
  query: string,
): DiscoveredResource | null {
  const wanted = norm(query)
  if (!wanted) return null
  const listable = resources.filter((r) => r.verbs.includes('list'))

  // `<plural>.<group>` — the unambiguous form kubectl accepts.
  const dotted = listable.find((r) => {
    const group = r.apiVersion.includes('/') ? r.apiVersion.split('/')[0]! : ''
    return group ? norm(`${r.plural}.${group}`) === wanted : false
  })
  if (dotted) return dotted

  return (
    listable.find((r) => norm(r.plural) === wanted) ??
    listable.find((r) => norm(r.kind) === wanted) ??
    listable.find((r) => r.singular && norm(r.singular) === wanted) ??
    listable.find((r) => r.shortNames.some((s) => norm(s) === wanted)) ??
    null
  )
}

/** One row of a generic list: the fields EVERY Kubernetes object has, plus a status hint. */
export interface GenericRow {
  name: string
  /** Absent for cluster-scoped objects. */
  namespace?: string
  /** RFC3339 `metadata.creationTimestamp`; empty when the server omitted it. */
  createdAt: string
  /** Generic health word, or empty when the kind exposes no generic notion of one. */
  status: string
}

/**
 * Normalize any Kubernetes object into a row.
 *
 * Only `metadata` is read as a guarantee — it is the one part of the schema every object shares. The
 * status hint is best-effort and DELIBERATELY narrow: `status.phase` (Pod, PVC, Namespace) then a
 * `Ready` condition (the convention CRDs follow, cert-manager and Argo included). Guessing further —
 * "if it has replicas, compare them" — is per-kind knowledge, and per-kind knowledge is exactly what
 * this generic path exists to stop accumulating. A kind with no generic status gets an empty string,
 * which a table renders as a blank cell rather than a wrong word.
 */
export function normalizeGenericRow(object: unknown): GenericRow | null {
  const obj = object as {
    metadata?: { name?: unknown; namespace?: unknown; creationTimestamp?: unknown }
    status?: { phase?: unknown; conditions?: unknown }
  } | null
  const name = asString(obj?.metadata?.name)
  // A nameless object cannot be selected, described or acted on — it is not a row.
  if (!name) return null
  const namespace = asString(obj?.metadata?.namespace)
  const created = obj?.metadata?.creationTimestamp
  return {
    name,
    ...(namespace ? { namespace } : {}),
    // The API sends RFC3339 text; a Date arrives when a client has already deserialized it.
    createdAt: created instanceof Date ? created.toISOString() : asString(created),
    status: genericStatus(obj?.status),
  }
}

function genericStatus(status: unknown): string {
  const phase = asString((status as { phase?: unknown } | null)?.phase)
  if (phase) return phase
  const conditions = (status as { conditions?: unknown } | null)?.conditions
  if (!Array.isArray(conditions)) return ''
  const ready = (conditions as Array<{ type?: unknown; status?: unknown }>).find(
    (c) => asString(c?.type) === 'Ready',
  )
  if (!ready) return ''
  const value = asString(ready.status)
  // 'Unknown' is a real third state in the condition convention; reporting it as NotReady would lie.
  return value === 'True' ? 'Ready' : value === 'False' ? 'NotReady' : value ? `Ready=${value}` : ''
}

/**
 * Every listable kind, de-duplicated by `apiVersion/kind` and sorted for a stable display.
 *
 * Core (`v1`) first, then groups alphabetically: a picker whose order changes per request is a picker
 * nobody can build muscle memory in, and the discovery responses arrive in whatever order the API
 * feels like.
 */
export function listableResources(resources: readonly DiscoveredResource[]): DiscoveredResource[] {
  const byId = new Map<string, DiscoveredResource>()
  for (const r of resources) {
    if (!r.verbs.includes('list')) continue
    byId.set(`${r.apiVersion}/${r.kind}`, r)
  }
  return [...byId.values()].sort((a, b) => {
    const coreA = a.apiVersion.includes('/') ? 1 : 0
    const coreB = b.apiVersion.includes('/') ? 1 : 0
    return coreA - coreB || a.apiVersion.localeCompare(b.apiVersion) || a.kind.localeCompare(b.kind)
  })
}
