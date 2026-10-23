import { useMemo } from 'react'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import type { DockerContainer } from '../../backend/contracts'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { SectionLabel } from '@localixai/kit/section-label'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import { dockerApi } from '../dockerApi'
import { filterContainers, groupContainers } from '../model/groupContainers'
import { openDockerContainerTab } from '../model/openTab'
import { sortDockerContainers } from '../model/sortResources'
import type { DockerWorkbenchModel } from '../model/useDocker'
import type { DockerSidebarActions } from '../model/useDockerSidebarActions'
import type { DockerViewState } from '../model/dockerView'
import { ContainerRow, type ContainerRowActions } from './ContainerRow'
import { DockerContainerListHeader } from './DockerListHeader'
import { DOCKER_RESOURCE_META } from './DockerResourceBar'
import { DockerResourceList } from './DockerResourceList'
import { ProjectGroupHeader } from './ProjectGroupHeader'

export function DockerSidebarInventory({
  docker,
  view,
  actions,
}: {
  docker: DockerWorkbenchModel
  view: DockerViewState
  actions: DockerSidebarActions
}) {
  const groups = useMemo(
    () =>
      groupContainers(filterContainers(docker.containers, view.filter)).map((group) => ({
        ...group,
        containers: sortDockerContainers(group.containers, view.sort.containers),
      })),
    [docker.containers, view.filter, view.sort.containers],
  )
  const activeError = docker.resourceErrors[view.resource]
  const hasSnapshot =
    view.resource === 'containers'
      ? docker.containers.length > 0
      : view.resource === 'images'
        ? docker.images.length > 0
        : view.resource === 'volumes'
          ? docker.volumes.length > 0
          : docker.networks.length > 0

  // Both problem owners stay MOUNTED and are handed `null` when healthy: rendered inside a branch,
  // each one unmounted exactly when its failure ended, so its Event Center row was never settled
  // and kept saying Docker was down after it came back.
  const engineIssue = docker.loading ? null : docker.error
  const collectionIssue = docker.loading || docker.error ? null : (activeError ?? null)
  const retry = () => void docker.refresh()

  return (
    <div className="@container scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      {docker.loading && <LoadingHint className="p-3">Loading containers…</LoadingHint>}
      <DevOpsProblem centered subject="Docker" issue={engineIssue} onRetry={retry} />
      <DevOpsProblem
        centered={!hasSnapshot}
        subject={DOCKER_RESOURCE_META[view.resource].label}
        issue={collectionIssue}
        onRetry={retry}
      />
      {!docker.loading && !docker.error && (hasSnapshot || !activeError) && (
        <>
          {view.resource === 'containers' ? (
            <ContainerInventory docker={docker} view={view} groups={groups} actions={actions} />
          ) : (
            <DockerResourceList
              resource={view.resource}
              query={view.filter}
              images={docker.images}
              volumes={docker.volumes}
              networks={docker.networks}
              sort={view.sort}
              onConfirm={actions.requestConfirm}
            />
          )}
        </>
      )}
    </div>
  )
}

function ContainerInventory({
  docker,
  view,
  groups,
  actions,
}: {
  docker: DockerWorkbenchModel
  view: DockerViewState
  groups: ReturnType<typeof groupContainers>
  actions: DockerSidebarActions
}) {
  // The container tab opens in THIS workspace's chat — the one its Exec will shell into.
  const sessionId = useWorkItemSessionId()
  // One bundle for the whole list: rows report their own container back, so a
  // container that did not change keeps identical props and the memo holds.
  const rowActions = useMemo<ContainerRowActions>(
    () => ({
      onOpen: (container) => {
        if (sessionId) openDockerContainerTab(sessionId, container.id, container.name)
      },
      onStart: (container) =>
        void actions.runContainerAction(container.id, () =>
          dockerApi.action(container.id, 'start'),
        ),
      onStop: (container) =>
        void actions.runContainerAction(container.id, () => dockerApi.action(container.id, 'stop')),
      onRestart: (container) =>
        void actions.runContainerAction(container.id, () =>
          dockerApi.action(container.id, 'restart'),
        ),
      onRemoveRequest: (container) => actions.requestRemove(container.id),
      onRemoveCancel: actions.cancelRemove,
      onRemoveConfirm: (container) =>
        void actions.runContainerAction(container.id, () =>
          dockerApi.remove(container.id, container.state === 'running'),
        ),
    }),
    [actions, sessionId],
  )

  if (groups.length === 0) {
    return (
      <EmptyHint className="p-4">
        {view.filter ? 'No matching containers.' : 'No containers.'}
      </EmptyHint>
    )
  }
  return (
    <>
      <DockerContainerListHeader />
      {groups.map((group) => (
        <div key={group.key} className="py-1">
          {group.kind === 'project' ? (
            <ProjectGroupHeader
              group={group}
              composeAvailable={docker.composeAvailable}
              onConfirm={actions.requestConfirm}
            />
          ) : (
            <SectionLabel className="px-3 py-1">
              {group.label} · {group.containers.length}
            </SectionLabel>
          )}
          <div role="list" aria-label={`${group.label} containers`}>
            {group.containers.map((container: DockerContainer) => (
              <ContainerRow
                key={container.id}
                container={container}
                showService={group.kind === 'project'}
                busy={!!actions.pending[container.id]}
                confirmingRemove={actions.confirmRemove === container.id}
                actions={rowActions}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
