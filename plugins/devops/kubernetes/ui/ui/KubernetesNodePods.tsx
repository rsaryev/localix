import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { SearchInput } from '@localixai/kit/search-input'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import type { KubernetesNodeTabModel } from '../model/useKubernetesNodeTab'
import { RelatedPodListHeader, RelatedPodRow } from './RelatedPodRow'

export function KubernetesNodePods({
  model,
  name,
  context,
}: {
  model: KubernetesNodeTabModel
  name: string
  context?: string
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border-soft px-3 py-2">
        <SearchInput
          size="md"
          value={model.podFilter}
          onValueChange={model.setPodFilter}
          placeholder="Search pods on this node…"
        />
      </div>
      <div className="@container scrollbar-thin min-h-0 flex-1 overflow-auto">
        {/* Mounted unconditionally, and on its own subject: the row settles only when the owner
            is handed `null`, and the sidebar already owns "Pods". */}
        <DevOpsProblem
          subject={`${name} pods`}
          // No "Showing the last successful snapshot." glued on: `stale` renders that on the line.
          issue={model.podsError ? { message: model.podsError } : null}
          onRetry={() => void model.refreshPods()}
        />
        {model.podsLoading && model.pods.length === 0 ? (
          <LoadingHint className="p-4">Loading node pods…</LoadingHint>
        ) : model.podsError && model.pods.length === 0 ? null : model.visiblePods.length === 0 ? (
          <EmptyHint className="p-4">
            {model.podFilter ? 'No matching pods on this node.' : 'No pods scheduled on this node.'}
          </EmptyHint>
        ) : (
          <>
            <RelatedPodListHeader primary="Pod / namespace / status" />
            <div role="list" aria-label={`Pods on ${name}`}>
              {model.visiblePods.map((pod) => (
                <RelatedPodRow
                  key={`${pod.namespace}/${pod.name}`}
                  pod={pod}
                  context={context}
                  showNamespace
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
