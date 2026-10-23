import { Server } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { RefreshAction } from '@localixai/kit/refresh-action'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import type { KubernetesNodeTabModel, KubernetesNodeView } from '../model/useKubernetesNodeTab'

const VIEWS: readonly { value: KubernetesNodeView; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'pods', label: 'Pods' },
  { value: 'manifest', label: 'Manifest' },
]

export function KubernetesNodeHeader({
  model,
  name,
  context,
}: {
  model: KubernetesNodeTabModel
  name: string
  context?: string
}) {
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border-soft px-3 py-2">
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center',
          model.node?.status === 'Ready' ? 'text-status-success' : 'text-status-warning',
        )}
      >
        <Server className="size-4" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        <span className="truncate text-2xs text-text-faint">
          Kubernetes node · {context || 'current context'}
        </span>
      </span>
      <SegmentedControl aria-label="Node view">
        {VIEWS.map((view) => (
          <SegmentedControlItem
            key={view.value}
            active={model.view === view.value}
            onClick={() => model.setView(view.value)}
          >
            {view.label}
            {view.value === 'pods' && model.pods.length > 0 ? ` ${model.pods.length}` : ''}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      <RefreshAction
        size="sm"
        aria-label="Refresh node"
        tooltip="Refresh node"
        disabled={model.loading || model.podsLoading}
        busy={model.loading || model.podsLoading}
        onClick={() => {
          void model.refresh()
          if (model.view === 'pods') void model.refreshPods()
        }}
      />
    </header>
  )
}
