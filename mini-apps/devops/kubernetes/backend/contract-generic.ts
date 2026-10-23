/**
 * Discovery-driven shapes: what the cluster reports it serves, and one row / list of
 * ANY kind resolved through that discovery.
 */

/**
 * One resource type the cluster reports it serves, from API discovery.
 *
 * The typed kinds above ({@link KubeResourceKind}, {@link KubeManifestKind}) name the handful with a
 * bespoke UI. This one is data, not a union, because the set is the CLUSTER's to decide: a CRD
 * installed a minute ago is as listable as `pods`, and a union would have to be edited to see it.
 */
export interface KubeApiResourceInfo {
  /** `v1` for core, else `group/version`. */
  apiVersion: string
  kind: string
  /** Plural name used in URLs — also the word a user is most likely to type. */
  plural: string
  /** Namespaced resources need a namespace; cluster-scoped ones must not receive one. */
  namespaced: boolean
}

/** What the cluster serves, plus the group-versions it advertised but could not answer. */
export interface KubeApiResources {
  resources: KubeApiResourceInfo[]
  /** Advertised-but-unreachable group-versions (a down aggregated API); NOT a failure. */
  unavailable: string[]
}

/** One row of a generic any-kind list: the metadata every object has, plus a status hint. */
export interface KubeGenericRow {
  name: string
  /** Absent for cluster-scoped objects. */
  namespace?: string
  /** RFC3339 creation timestamp; empty when the server omitted it. */
  createdAt: string
  /** Generic health word (`status.phase` or a `Ready` condition); empty when the kind has none. */
  status: string
}

/** A generic list of any resource kind, resolved through API discovery. */
export interface KubeGenericList {
  apiVersion: string
  kind: string
  namespaced: boolean
  rows: KubeGenericRow[]
  /** True when the server had more objects than the requested limit. */
  truncated: boolean
}
