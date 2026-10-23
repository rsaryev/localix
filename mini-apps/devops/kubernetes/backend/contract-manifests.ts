/** Manifest shapes: the kinds viewable as YAML, that YAML, and an apply result. */

/** A kind whose live API object can be viewed/edited as YAML.
 *  Superset of {@link KubeResourceKind} that also covers pods + cluster-scoped nodes. */
export type KubeManifestKind = 'pod' | 'deployment' | 'service' | 'node'

/** A resource's live API object serialized as YAML. */
export interface KubeManifest {
  kind: KubeManifestKind
  name: string
  /** Empty for cluster-scoped kinds (nodes). */
  namespace: string
  yaml: string
}

/** The result of a successful server-side apply. */
export interface KubeApplyResult {
  output: string
}
