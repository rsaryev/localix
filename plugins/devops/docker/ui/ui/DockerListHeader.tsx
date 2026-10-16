import { ResourceListHeader } from '../../../ui/ResourceListHeader'

/** One shared column contract for image/volume/network legends and rows. The
 * action cell remains present so a missing action never shifts metadata; its
 * 4.75rem track matches every other inventory, wide enough for the header's
 * "Actions" legend that a 1.75rem track visibly clipped. */
export const DOCKER_RESOURCE_GRID =
  'grid grid-cols-[minmax(0,1fr)_6rem_4.75rem] items-center gap-2 @md:grid-cols-[minmax(0,1fr)_6rem_11rem_4.75rem]'

/** Container rows progressively add operational detail according to the list
 * container itself, not the browser viewport (split panes can be very narrow). */
export const DOCKER_CONTAINER_GRID =
  'grid grid-cols-[minmax(0,1fr)_4.75rem] items-center gap-2 @md:grid-cols-[minmax(0,1fr)_10rem_4.75rem] @xl:grid-cols-[minmax(0,1fr)_10rem_8rem_4.75rem] @3xl:grid-cols-[minmax(0,1fr)_10rem_8rem_11rem_4.75rem]'

/** Sticky column legends for full-width Docker inventory lists. */
export function DockerContainerListHeader() {
  return (
    <ResourceListHeader gridClassName={DOCKER_CONTAINER_GRID}>
      <span className="min-w-0 flex-1">Container</span>
      <span className="hidden @md:block">Image</span>
      <span className="hidden @xl:block">Status</span>
      <span className="hidden @3xl:block">Ports</span>
      <span className="text-right">Actions</span>
    </ResourceListHeader>
  )
}

export function DockerResourceListHeader({
  resource,
  meta,
  secondary,
}: {
  resource: string
  meta: string
  secondary: string
}) {
  return (
    <ResourceListHeader gridClassName={DOCKER_RESOURCE_GRID}>
      <span className="min-w-0 flex-1">{resource}</span>
      <span className="text-right">{meta}</span>
      <span className="hidden text-right @md:block">{secondary}</span>
      <span className="text-right">Actions</span>
    </ResourceListHeader>
  )
}
