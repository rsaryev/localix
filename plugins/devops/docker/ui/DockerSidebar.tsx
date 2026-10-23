import { loadDockerView, saveDockerView, type DockerResourceView } from './model/dockerView'
import type { DockerWorkbenchModel } from './model/useDocker'
import { useDockerSidebarActions } from './model/useDockerSidebarActions'
import { DevOpsProblem } from '../../ui/DevOpsProblem'
import { useSidebarView } from '../../ui/model/useSidebarView'
import { DockerSidebarDialog } from './ui/DockerSidebarDialog'
import { DockerSidebarHeader } from './ui/DockerSidebarHeader'
import { DockerSidebarInventory } from './ui/DockerSidebarInventory'

/** Provider view with its data lifecycle injected by the DevOps Workspace shell. */
export function DockerSidebarView({
  docker,
  requestedResource,
  embedded = false,
}: {
  docker: DockerWorkbenchModel
  requestedResource?: DockerResourceView
  embedded?: boolean
}) {
  const { view, setFilter, setResource, setSort } = useSidebarView(
    loadDockerView,
    saveDockerView,
    requestedResource,
  )
  const actions = useDockerSidebarActions(docker)
  const counts: Record<DockerResourceView, number> = {
    containers: docker.containers.length,
    images: docker.images.length,
    volumes: docker.volumes.length,
    networks: docker.networks.length,
  }

  return (
    <div className="@container flex h-full flex-col">
      <DockerSidebarHeader
        docker={docker}
        actions={actions}
        embedded={embedded}
        view={view}
        counts={counts}
        onFilterChange={setFilter}
        onResourceChange={setResource}
        onSortChange={setSort}
      />

      <DevOpsProblem
        subject="Docker actions"
        issue={actions.actionError}
        onDismiss={actions.dismissActionError}
      />

      <DockerSidebarInventory docker={docker} view={view} actions={actions} />
      <DockerSidebarDialog actions={actions} />
    </div>
  )
}
