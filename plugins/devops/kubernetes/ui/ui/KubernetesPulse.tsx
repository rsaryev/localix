import { StatusDot } from '@localixai/kit/status-dot'
import type { ClusterPulse } from '../model/clusterPulse'

function Score({
  label,
  ready,
  total,
  bad,
}: {
  label: string
  ready: number
  total: number
  bad?: boolean
}) {
  return (
    <div className="min-w-0 px-2 py-1.5">
      <div className="flex items-center gap-1 text-2xs text-text-faint">
        <StatusDot
          className={
            total === 0
              ? 'bg-text-faint'
              : bad || ready < total
                ? 'bg-status-warning'
                : 'bg-status-success'
          }
        />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 text-xs font-medium tabular-nums text-foreground">
        {ready}
        <span className="font-normal text-text-faint">/{total}</span>
      </div>
    </div>
  )
}

export function KubernetesPulse({ pulse }: { pulse: ClusterPulse }) {
  return (
    <div className="grid grid-cols-3 divide-x divide-border-soft border-b border-border-soft">
      <Score
        label="Pods ready"
        ready={pulse.pods.ready}
        total={pulse.pods.total}
        bad={pulse.pods.faults > 0}
      />
      <Score label="Deploy ready" ready={pulse.deployments.ready} total={pulse.deployments.total} />
      <Score label="Nodes ready" ready={pulse.nodes.ready} total={pulse.nodes.total} />
    </div>
  )
}
