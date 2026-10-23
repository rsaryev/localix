import { degrade, toKubeIssue, type KubeCollection, type KubernetesState } from './kubernetesState'

const COLLECTIONS: readonly KubeCollection[] = [
  'pods',
  'deployments',
  'services',
  'nodes',
  'portForwards',
]

export function collectionErrors(
  results: readonly PromiseSettledResult<unknown>[],
): Partial<Record<KubeCollection, ReturnType<typeof toKubeIssue>>> {
  const errors: Partial<Record<KubeCollection, ReturnType<typeof toKubeIssue>>> = {}
  results.forEach((result, index) => {
    if (result.status === 'rejected') errors[COLLECTIONS[index]!] = toKubeIssue(result.reason)
  })
  return errors
}

export function collectionRootState(
  cause: unknown,
): Pick<KubernetesState, 'unavailable' | 'unreachable' | 'error'> {
  const issue = toKubeIssue(cause)
  const blocksCluster =
    issue.code === 'no_kubeconfig' ||
    issue.code === 'authentication_failed' ||
    issue.code === 'invalid_context' ||
    issue.code === 'certificate_error' ||
    issue.code === 'context_unreachable'
  return blocksCluster ? degrade(cause) : { unavailable: false, unreachable: false, error: null }
}
