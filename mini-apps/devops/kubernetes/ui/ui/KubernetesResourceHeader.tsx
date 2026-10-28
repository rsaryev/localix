import { Layers, Network as NetworkIcon, Scaling } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { RefreshAction } from '@localixai/kit/refresh-action'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import type { KubeResourceKind } from '../../backend/contracts'
import type {
  KubernetesResourceTabModel,
  KubernetesResourceView,
} from '../model/useKubernetesResourceTab'

const VIEWS: readonly {
  value: KubernetesResourceView
  label: string
  deploymentOnly?: boolean
}[] = [
  { value: 'describe', label: 'Describe' },
  { value: 'pods', label: 'Pods', deploymentOnly: true },
  { value: 'events', label: 'Events' },
  { value: 'manifest', label: 'Manifest' },
]

export function KubernetesResourceHeader({
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
  const Icon = resourceKind === 'deployment' ? Layers : NetworkIcon
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border-soft px-3 py-2">
      <Icon className="size-4 shrink-0 text-text-faint" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        <span className="truncate text-2xs text-text-faint">
          {resourceKind} · {namespace}
          {context ? ` · ${context}` : ''}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-1 @max-sm:ml-0 @max-sm:w-full @max-sm:flex-wrap">
        <SegmentedControl aria-label="Resource view">
          {VIEWS.filter((view) => !view.deploymentOnly || resourceKind === 'deployment').map(
            (view) => (
              <SegmentedControlItem
                key={view.value}
                active={model.view === view.value}
                onClick={() => model.setView(view.value)}
              >
                {view.label}
              </SegmentedControlItem>
            ),
          )}
        </SegmentedControl>
        {resourceKind === 'deployment' && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Scale deployment"
            title="Scale deployment"
            disabled={!model.deployment}
            onClick={model.openScale}
          >
            <Scaling className="size-3" />
            <span className="@max-sm:sr-only">Scale</span>
          </Button>
        )}
        {model.view !== 'manifest' && (
          <RefreshAction
            aria-label="Refresh"
            tooltip="Refresh"
            onClick={() => {
              void model.refresh()
              void model.loadDeployment()
            }}
          />
        )}
      </div>
    </header>
  )
}
