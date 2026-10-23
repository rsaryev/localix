import { ArrowUpRight } from 'lucide-react'
import type { KubePod } from '../../backend/contracts'
import { DetailField } from '@localixai/kit/detail-field'
import { podStatusLabel } from '../model/groupPods'
import { formatResourceAge } from '../../../ui/model/resourceAge'
import { openKubernetesNodeTabByName } from '../model/openTab'

/** Stable pod identity/status fields shown between the action header and active view. */
export function PodSummary({
  sessionId,
  pod,
  context,
}: {
  /** The pod tab's chat — the node tab opens beside it there. */
  sessionId: string
  pod: KubePod
  context?: string
}) {
  const age = formatResourceAge(pod.createdAt)
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-border-soft px-3 py-2 text-xs @sm:grid-cols-4">
      <DetailField label="Status" value={podStatusLabel(pod)} />
      <DetailField label="Ready" value={pod.ready} />
      <DetailField label="Restarts" value={String(pod.restarts)} />
      <DetailField label="Age" value={age || '—'} />
      {pod.node ? (
        <div className="flex min-w-0 gap-1.5">
          <span className="shrink-0 text-text-faint">Node:</span>
          <button
            type="button"
            className="flex min-w-0 items-center gap-1 truncate text-text-soft underline decoration-border underline-offset-2 outline-none hover:text-foreground focus-ring"
            title={`Open node ${pod.node}`}
            onClick={() => openKubernetesNodeTabByName(sessionId, pod.node, context)}
          >
            <span className="truncate">{pod.node}</span>
            <ArrowUpRight className="size-3 shrink-0" />
          </button>
        </div>
      ) : (
        <DetailField label="Node" value="—" />
      )}
      <DetailField label="Pod IP" value={pod.podIP || '—'} />
    </div>
  )
}
