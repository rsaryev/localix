import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import { LogPane } from '@localixai/kit/log-pane'
import type { KubeResourceKind } from '../../backend/contracts'
import type { KubernetesResourceTabModel } from '../model/useKubernetesResourceTab'
import { EventsTable } from './EventsTable'
import { ManifestView } from './ManifestView'
import { RelatedPodListHeader, RelatedPodRow } from './RelatedPodRow'

export function KubernetesResourceContent({
  model,
  resourceKind,
  name,
  namespace,
  context,
}: {
  model: KubernetesResourceTabModel
  resourceKind: KubeResourceKind
  name: string
  namespace: string
  context?: string
}) {
  if (model.view === 'manifest') {
    return (
      <ManifestView
        kind={resourceKind}
        name={name}
        namespace={namespace}
        context={model.resolvedContext}
      />
    )
  }
  if (model.loading) return <LoadingHint className="p-4">Loading…</LoadingHint>
  // A pane that is empty BECAUSE something failed is not an empty state: `EmptyHint` said so in
  // grey text nothing durable ever saw.
  if (model.error) return <DevOpsProblem centered subject={name} issue={{ message: model.error }} />
  if (model.view === 'pods') {
    return model.pods.length === 0 ? (
      <EmptyHint className="p-4">No pods match this deployment&apos;s selector.</EmptyHint>
    ) : (
      <div className="@container scrollbar-thin h-full overflow-auto">
        <RelatedPodListHeader primary="Pod / status" />
        <div role="list" aria-label={`Pods owned by ${name}`}>
          {model.pods.map((pod) => (
            <RelatedPodRow key={`${pod.namespace}/${pod.name}`} pod={pod} context={context} />
          ))}
        </div>
      </div>
    )
  }
  if (model.view === 'events') {
    return (
      <EventsTable
        events={model.events}
        emptyLabel={`No recent events for this ${resourceKind}.`}
      />
    )
  }
  return <LogPane aria-label="Describe output">{model.describe || 'No output.'}</LogPane>
}
