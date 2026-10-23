import { useMemo } from 'react'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'

import type { KubePod } from '../../backend/contracts'
import { ALL_NAMESPACES } from '../../backend/contracts'
import { SectionLabel } from '@localixai/kit/section-label'
import { filterPods, groupPods } from '../model/groupPods'
import { openKubernetesPodTab, openKubernetesResourceTab } from '../model/openTab'
import { sortKubeDeployments, sortKubePods } from '../model/sortResources'
import { podUsageKey } from '../model/usage'
import { KubernetesListHeader } from './KubernetesListHeader'
import { DeploymentRow, PodRow, type PodRowActions } from './SidebarRows'
import { EmptyResource, matchesResourceQuery } from './resourceListPresentation'
import type { KubernetesResourceListProps } from './resourceListTypes'

type PodRowsProps = Pick<
  KubernetesResourceListProps,
  'context' | 'namespace' | 'podUsage' | 'pendingPods' | 'onForward' | 'onDeleteRequest'
> & {
  pods: KubePod[]
  ariaLabel: string
}

function PodRows({
  pods,
  ariaLabel,
  context,
  namespace,
  podUsage,
  pendingPods,
  onForward,
  onDeleteRequest,
}: PodRowsProps) {
  // A pod tab opens in the chat of the workspace listing it — the one its Exec shells into.
  const sessionId = useWorkItemSessionId()
  // One bundle for the whole list: rows report their own pod back, so a pod that did
  // not change between polls keeps identical props and its memo holds.
  const actions = useMemo<PodRowActions>(
    () => ({
      onOpen: (pod) => {
        if (sessionId) openKubernetesPodTab(sessionId, pod.name, pod.namespace, context, pod)
      },
      onForward,
      onDeleteRequest,
    }),
    [sessionId, context, onForward, onDeleteRequest],
  )
  return (
    <div role="list" aria-label={ariaLabel}>
      {pods.map((pod) => (
        <PodRow
          key={`${pod.namespace}/${pod.name}`}
          pod={pod}
          context={context}
          usage={podUsage.get(podUsageKey(pod.namespace, pod.name))}
          showNamespace={namespace === ALL_NAMESPACES}
          busy={!!pendingPods[`${pod.namespace}/${pod.name}`]}
          actions={actions}
        />
      ))}
    </div>
  )
}

export function KubernetesWorkloadsList(props: KubernetesResourceListProps) {
  const sessionId = useWorkItemSessionId()
  const visibleDeployments = sortKubeDeployments(
    props.deployments.filter((deployment) =>
      matchesResourceQuery(props.query, deployment.name, deployment.namespace, deployment.ready),
    ),
    props.sort,
  )
  const visiblePods = sortKubePods(filterPods(props.pods, props.query), props.sort)
  if (!visibleDeployments.length && !visiblePods.length) {
    return <EmptyResource resource="workloads" filtered={!!props.query.trim()} />
  }
  return (
    <div className="py-1">
      {visibleDeployments.length > 0 && (
        <section aria-label="Deployment controllers">
          <SectionLabel className="px-3 py-1.5">
            Deployments · {visibleDeployments.length}
          </SectionLabel>
          <div role="list" aria-label="Workload deployments">
            {visibleDeployments.map((deployment) => (
              <DeploymentRow
                key={`${deployment.namespace}/${deployment.name}`}
                dep={deployment}
                context={props.context}
                showNamespace={props.namespace === ALL_NAMESPACES}
                onOpen={() => {
                  if (!sessionId) return
                  openKubernetesResourceTab(
                    sessionId,
                    'deployment',
                    deployment.name,
                    deployment.namespace,
                    props.context,
                  )
                }}
                onScale={() => props.onScale(deployment)}
                onRestart={() => props.onRestart(deployment)}
              />
            ))}
          </div>
        </section>
      )}

      {visiblePods.length > 0 && (
        <section aria-label="Runtime pods">
          <SectionLabel className="px-3 py-1.5">Runtime pods · {visiblePods.length}</SectionLabel>
          <PodRows {...props} pods={visiblePods} ariaLabel="Workload pods" />
        </section>
      )}
    </div>
  )
}

export function KubernetesPodsList(props: KubernetesResourceListProps) {
  const visible = sortKubePods(filterPods(props.pods, props.query), props.sort)
  if (!visible.length) {
    return <EmptyResource resource="pods" filtered={!!props.query.trim()} />
  }
  return (
    <>
      <KubernetesListHeader primary="Pod / status" secondary="Ready · restarts · age" />
      {groupPods(visible).map((group) => (
        <div key={group.key} className="py-0.5">
          <SectionLabel className="px-3 py-0.5">
            {group.label} · {group.pods.length}
          </SectionLabel>
          <PodRows {...props} pods={group.pods} ariaLabel={`${group.label} pods`} />
        </div>
      ))}
    </>
  )
}
