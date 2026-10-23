export interface KubernetesScopeStamp {
  generation: number
  context: string
  namespace?: string
}

export interface KubernetesActiveScope {
  context: string
  namespace: string
}

/** Reject async commits captured before a context or namespace switch. */
export function kubernetesScopeIsCurrent(
  current: KubernetesActiveScope,
  generation: number,
  stamp: KubernetesScopeStamp,
): boolean {
  return (
    generation === stamp.generation &&
    current.context === stamp.context &&
    (stamp.namespace === undefined || current.namespace === stamp.namespace)
  )
}
