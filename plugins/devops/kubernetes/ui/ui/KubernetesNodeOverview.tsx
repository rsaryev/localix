import { DetailField } from '@localixai/kit/detail-field'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import type { KubernetesNodeTabModel } from '../model/useKubernetesNodeTab'
import { formatCpu, formatMemory, formatUsageShare } from '../model/usage'

function usageField(amount: string | undefined, percent: number | null | undefined): string {
  return amount ? formatUsageShare(amount, percent ?? null) : '—'
}

export function KubernetesNodeOverview({
  model,
  name,
}: {
  model: KubernetesNodeTabModel
  /** Which node — two open node tabs are two subjects. */
  name: string
}) {
  if (model.loading && !model.node) {
    return <LoadingHint className="p-4">Loading node…</LoadingHint>
  }
  if (model.error && !model.node) {
    return (
      <DevOpsProblem
        centered
        subject={name}
        issue={{ message: model.error }}
        onRetry={() => void model.refresh()}
      />
    )
  }
  if (!model.node) return null
  const node = model.node
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DevOpsProblem
        subject={name}
        // No "Showing the last successful snapshot." glued on: `stale` renders that on the line.
        issue={model.error ? { message: model.error } : null}
        onRetry={() => void model.refresh()}
      />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <div className="grid gap-x-8 gap-y-3 border-y border-border-soft p-3 text-xs @sm:grid-cols-2">
          <DetailField label="Status" value={node.status} />
          <DetailField label="Scheduling" value={node.schedulable ? 'Schedulable' : 'Cordoned'} />
          <DetailField label="Roles" value={node.roles.join(', ') || '—'} />
          <DetailField label="CPU" value={usageField(model.usage?.cpu, model.usage?.cpuPercent)} />
          <DetailField
            label="Memory"
            value={usageField(model.usage?.memory, model.usage?.memoryPercent)}
          />
          <DetailField
            label="Reserved"
            value={
              model.reservation
                ? `${formatUsageShare(model.reservation.cpu, model.reservation.cpuPercent)} CPU · ${formatUsageShare(model.reservation.memory, model.reservation.memoryPercent)}`
                : '—'
            }
          />
          <DetailField
            label="Allocatable"
            value={
              node.allocatableCpuNanos || node.allocatableMemoryBytes
                ? `${formatCpu(node.allocatableCpuNanos)} CPU · ${formatMemory(node.allocatableMemoryBytes)}`
                : '—'
            }
          />
          <DetailField label="Kubelet" value={node.version || '—'} />
          <DetailField label="Created" value={node.createdAt || '—'} />
        </div>
      </div>
    </div>
  )
}
