import { Container, HardDrive, Layers, Network } from 'lucide-react'
import { ResourceKindBar } from '../../../ui/ResourceKindBar'
import type { DockerResourceView } from '../model/dockerView'

export const DOCKER_RESOURCE_META: Record<
  DockerResourceView,
  { label: string; shortLabel: string; icon: typeof Container }
> = {
  containers: { label: 'Containers', shortLabel: 'Containers', icon: Container },
  images: { label: 'Images', shortLabel: 'Images', icon: Layers },
  volumes: { label: 'Volumes', shortLabel: 'Volumes', icon: HardDrive },
  networks: { label: 'Networks', shortLabel: 'Networks', icon: Network },
}

export const DOCKER_RESOURCE_ORDER = Object.keys(DOCKER_RESOURCE_META) as DockerResourceView[]

export function DockerResourceBar({
  value,
  counts,
  onChange,
}: {
  value: DockerResourceView
  counts: Record<DockerResourceView, number>
  onChange: (value: DockerResourceView) => void
}) {
  return (
    <ResourceKindBar
      ariaLabel="Container resource kinds"
      value={value}
      order={DOCKER_RESOURCE_ORDER}
      meta={DOCKER_RESOURCE_META}
      counts={counts}
      onChange={onChange}
    />
  )
}
