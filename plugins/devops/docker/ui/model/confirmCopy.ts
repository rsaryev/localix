import type { PruneTarget } from '../../backend/contracts'

/** A pending destructive sidebar action the ConfirmDialog gates (prune / image /
 *  volume / network removal, compose-project batch stop/restart, compose up). */
export type DockerConfirm =
  | { kind: 'prune'; target: PruneTarget }
  | { kind: 'image'; id: string; ref: string }
  | { kind: 'volume'; name: string }
  | { kind: 'network'; id: string; name: string }
  | { kind: 'project'; action: 'stop' | 'restart'; project: string; ids: string[] }
  | { kind: 'compose-up'; project: string }

export interface ConfirmCopy {
  title: string
  description: string
  confirmLabel: string
}

const PRUNE_COPY: Record<PruneTarget, { title: string; description: string }> = {
  containers: {
    title: 'Prune stopped containers?',
    description: 'Removes all stopped containers. This cannot be undone.',
  },
  images: {
    title: 'Prune dangling images?',
    description: 'Removes all dangling images to reclaim disk space. This cannot be undone.',
  },
  volumes: {
    title: 'Prune unused volumes?',
    description:
      'Removes all volumes not used by any container — their data is lost. This cannot be undone.',
  },
  networks: {
    title: 'Prune unused networks?',
    description: 'Removes all networks not used by any container. This cannot be undone.',
  },
}

/** Dialog copy for a pending confirm — pure so the sidebar stays a thin render. */
export function confirmCopy(confirm: DockerConfirm): ConfirmCopy {
  switch (confirm.kind) {
    case 'prune':
      return { ...PRUNE_COPY[confirm.target], confirmLabel: 'Prune' }
    case 'image':
      return {
        title: `Remove image ${confirm.ref}?`,
        description:
          'Removes this image. If a container still uses it, remove the container first or the removal is refused.',
        confirmLabel: 'Remove',
      }
    case 'volume':
      return {
        title: `Remove volume ${confirm.name}?`,
        description: 'Any data stored in this volume is permanently deleted.',
        confirmLabel: 'Remove',
      }
    case 'network':
      return {
        title: `Remove network ${confirm.name}?`,
        description: 'This removes the network. Containers must be disconnected first.',
        confirmLabel: 'Remove',
      }
    case 'project': {
      const stop = confirm.action === 'stop'
      return {
        title: `${stop ? 'Stop' : 'Restart'} all of ${confirm.project}?`,
        description: `${stop ? 'Stops' : 'Restarts'} all ${confirm.ids.length} container(s) in this Compose project.`,
        confirmLabel: stop ? 'Stop all' : 'Restart all',
      }
    }
    case 'compose-up':
      return {
        title: `Bring up ${confirm.project}?`,
        description:
          'Runs docker compose up -d for this project — starts (and may recreate/pull) its services.',
        confirmLabel: 'Up',
      }
  }
}
