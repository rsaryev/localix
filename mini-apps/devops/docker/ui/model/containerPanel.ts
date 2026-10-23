import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

export type DockerContainerPanel = 'logs' | 'stats' | 'top'
export type DockerContainerSection = 'logs' | 'stats' | 'processes'

const PANEL_STORAGE_KEY = 'localix_docker_panel'

export function normalizeDockerContainerPanel(value: unknown): DockerContainerPanel {
  return value === 'logs' || value === 'stats' || value === 'top' ? value : 'logs'
}

export function loadDockerContainerPanel(): DockerContainerPanel {
  return normalizeDockerContainerPanel(loadString(PANEL_STORAGE_KEY))
}

export function saveDockerContainerPanel(panel: DockerContainerPanel): void {
  saveString(PANEL_STORAGE_KEY, panel)
}

/**
 * Whether a container tab still needs its three-second tick.
 *
 * The tick reads the container's state, plus whichever of the log tail, stats or processes is on
 * screen — and only the state is something `docker events` announces. So while the stream is live,
 * a tick that would read nothing but the state is dropped: a STOPPED container (its logs do not
 * grow, its stats and processes are cleared; a `start` event re-reads) and a paused log view. A
 * running container's log tail is announced too while its `docker logs --follow` is live
 * (`logsFollowed`): the tab reads the new lines when they arrive. Stats and processes are gauges,
 * sampled, never announced, and keep the tick. An unknown container (still loading, or a failed
 * read) keeps it too: no event repairs a failure.
 */
export function containerPollNeeded({
  live,
  panel,
  logsLive,
  state,
  logsFollowed = false,
}: {
  live: boolean
  panel: DockerContainerPanel
  logsLive: boolean
  /** The container's state from the last read, `null` when it is not known. */
  state: string | null
  /** The log follow stream for this container is live. */
  logsFollowed?: boolean
}): boolean {
  if (!live || state === null) return true
  if (state !== 'running' && state !== 'restarting') return false
  return !(panel === 'logs' && (!logsLive || logsFollowed))
}

/** Whether an event's subject is this tab's container (either id may be the short form). */
export function sameContainer(eventId: string, containerId: string): boolean {
  return Boolean(eventId) && (eventId.startsWith(containerId) || containerId.startsWith(eventId))
}

export function dockerContainerSection(panel: DockerContainerPanel): DockerContainerSection {
  return panel === 'top' ? 'processes' : panel
}
