import { Brush } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchFilterBar } from '@localixai/kit/workbench-filter-bar'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { ResourceSortControl } from '../../../ui/ResourceSortControl'
import type { ResourceSort } from '../../../ui/model/resourceSort'
import type { DockerWorkbenchModel } from '../model/useDocker'
import type { DockerSidebarActions } from '../model/useDockerSidebarActions'
import {
  DOCKER_SORT_OPTIONS,
  type DockerResourceView,
  type DockerSortKey,
  type DockerViewState,
} from '../model/dockerView'
import { DockerResourceBar, DOCKER_RESOURCE_META } from './DockerResourceBar'

function PruneButton({ resource, onClick }: { resource: DockerResourceView; onClick: () => void }) {
  return (
    <IconButton
      size="sm"
      aria-label={`Prune ${resource}`}
      tooltip={`Prune ${resource}`}
      onClick={onClick}
    >
      <Brush className="size-3.5" />
    </IconButton>
  )
}

export function DockerSidebarHeader({
  docker,
  actions,
  embedded,
  view,
  counts,
  onFilterChange,
  onResourceChange,
  onSortChange,
}: {
  docker: DockerWorkbenchModel
  actions: DockerSidebarActions
  embedded: boolean
  view: DockerViewState
  counts: Record<DockerResourceView, number>
  onFilterChange: (filter: string) => void
  onResourceChange: (resource: DockerResourceView) => void
  onSortChange: (sort: ResourceSort<DockerSortKey>) => void
}) {
  const refresh = () => void docker.refresh()
  const prune = () => actions.requestConfirm({ kind: 'prune', target: view.resource })
  const inventoryVisible = !docker.loading && !docker.unavailable && !docker.error
  const refreshBusy = docker.loading || docker.refreshing
  return (
    <>
      {!embedded && (
        <PanelHeader
          title="Docker"
          tone="content"
          actions={
            <>
              {!docker.unavailable && <PruneButton resource={view.resource} onClick={prune} />}
              <RefreshAction
                aria-label="Refresh"
                tooltip="Refresh"
                busy={refreshBusy}
                disabled={refreshBusy}
                onClick={refresh}
              />
            </>
          }
        />
      )}

      {inventoryVisible && (
        <>
          <DockerResourceBar value={view.resource} counts={counts} onChange={onResourceChange} />
          <WorkbenchFilterBar aria-label="Docker filters">
            <SearchInput
              value={view.filter}
              onValueChange={onFilterChange}
              placeholder={`Filter ${DOCKER_RESOURCE_META[view.resource].label.toLowerCase()}…`}
              tone="default"
              className="w-full"
            />
            <div className="flex min-w-0 items-center justify-end gap-1 self-end">
              <ResourceSortControl<DockerSortKey>
                sort={view.sort[view.resource]}
                options={DOCKER_SORT_OPTIONS[view.resource]}
                onChange={onSortChange}
              />
              {embedded && (
                <>
                  <PruneButton resource={view.resource} onClick={prune} />
                  <RefreshAction
                    aria-label="Refresh"
                    tooltip="Refresh"
                    busy={refreshBusy}
                    disabled={refreshBusy}
                    onClick={refresh}
                  />
                </>
              )}
            </div>
          </WorkbenchFilterBar>
        </>
      )}
    </>
  )
}
