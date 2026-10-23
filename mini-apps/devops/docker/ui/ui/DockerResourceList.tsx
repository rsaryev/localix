import { HardDrive, Layers, Network as NetworkIcon } from 'lucide-react'

import type { DockerImage, DockerNetwork, DockerVolume } from '../../backend/contracts'
import type { DockerConfirm } from '../model/confirmCopy'
import type { DockerResourceView, DockerSortState } from '../model/dockerView'
import { dockerEntityUri, openDockerResourceTab } from '../model/openTab'
import { sortDockerImages, sortDockerNetworks, sortDockerVolumes } from '../model/sortResources'
import { DockerResourceListHeader } from './DockerListHeader'
import { EmptyRow, ResourceRow } from './ResourceRow'

function match(query: string, ...values: Array<string | undefined>): boolean {
  const normalized = query.trim().toLowerCase()
  return !normalized || values.some((value) => value?.toLowerCase().includes(normalized))
}

export function DockerResourceList({
  resource,
  query,
  images,
  volumes,
  networks,
  sort,
  onConfirm,
}: {
  resource: Exclude<DockerResourceView, 'containers'>
  query: string
  images: DockerImage[]
  volumes: DockerVolume[]
  networks: DockerNetwork[]
  sort: DockerSortState
  onConfirm: (confirm: DockerConfirm) => void
}) {
  if (resource === 'images') {
    const visible = sortDockerImages(
      images.filter((image) => match(query, image.id, image.repository, image.tag, image.size)),
      sort.images,
    )
    return visible.length === 0 ? (
      <EmptyRow>{query ? 'No matching images.' : 'No images.'}</EmptyRow>
    ) : (
      <>
        <DockerResourceListHeader resource="Image" meta="Size" secondary="Created" />
        <div role="list" aria-label="Images">
          {visible.map((image) => {
            const hasTag = Boolean(image.tag && image.tag !== '<none>')
            const ref = image.repository + (hasTag ? `:${image.tag}` : '')
            return (
              <ResourceRow
                key={image.id + image.tag}
                icon={<Layers className="size-3 shrink-0 text-text-faint" />}
                label={
                  <>
                    {image.repository}
                    {hasTag ? <span className="text-text-faint">:{image.tag}</span> : null}
                  </>
                }
                titleText={ref}
                meta={image.size}
                secondaryMeta={image.createdAt}
                dragUri={dockerEntityUri('image', image.id)}
                dragLabel={ref}
                removeLabel="Remove image"
                onOpen={() => openDockerResourceTab({ kind: 'image', resource: image })}
                onRemove={() => onConfirm({ kind: 'image', id: image.id, ref })}
              />
            )
          })}
        </div>
      </>
    )
  }

  if (resource === 'volumes') {
    const visible = sortDockerVolumes(
      volumes.filter((volume) => match(query, volume.name, volume.driver, volume.scope)),
      sort.volumes,
    )
    return visible.length === 0 ? (
      <EmptyRow>{query ? 'No matching volumes.' : 'No volumes.'}</EmptyRow>
    ) : (
      <>
        <DockerResourceListHeader resource="Volume" meta="Driver" secondary="Scope" />
        <div role="list" aria-label="Volumes">
          {visible.map((volume) => (
            <ResourceRow
              key={volume.name}
              icon={<HardDrive className="size-3 shrink-0 text-text-faint" />}
              label={volume.name}
              meta={volume.driver}
              secondaryMeta={volume.scope}
              dragUri={dockerEntityUri('volume', volume.name)}
              dragLabel={volume.name}
              onOpen={() => openDockerResourceTab({ kind: 'volume', resource: volume })}
              onRemove={() => onConfirm({ kind: 'volume', name: volume.name })}
            />
          ))}
        </div>
      </>
    )
  }

  const visible = sortDockerNetworks(
    networks.filter((network) =>
      match(query, network.id, network.name, network.driver, network.scope),
    ),
    sort.networks,
  )
  return visible.length === 0 ? (
    <EmptyRow>{query ? 'No matching networks.' : 'No networks.'}</EmptyRow>
  ) : (
    <>
      <DockerResourceListHeader resource="Network" meta="Driver" secondary="Scope" />
      <div role="list" aria-label="Networks">
        {visible.map((network) => (
          <ResourceRow
            key={network.id}
            icon={<NetworkIcon className="size-3 shrink-0 text-text-faint" />}
            label={network.name}
            meta={network.driver}
            secondaryMeta={network.scope}
            dragUri={dockerEntityUri('network', network.id)}
            dragLabel={network.name}
            onOpen={() => openDockerResourceTab({ kind: 'network', resource: network })}
            onRemove={
              network.name === 'bridge' || network.name === 'host' || network.name === 'none'
                ? undefined
                : () => onConfirm({ kind: 'network', id: network.id, name: network.name })
            }
          />
        ))}
      </div>
    </>
  )
}
