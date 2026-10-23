import type { ContainerState, DockerContainer } from '../../backend/contracts'

/** Sidebar grouping. Compose projects (containers carrying the
 *  `com.docker.compose.project` label) group into their own `project` sections —
 *  project → service — while everything else falls into the
 *  `running`/`stopped` state groups. Pure so the sidebar stays a thin render. */
export interface ContainerGroup {
  /** Stable key: `running` | `stopped` for state groups, `project:<name>` otherwise. */
  key: string
  kind: 'state' | 'project'
  label: string
  /** Compose project name (only on `kind: 'project'` groups). */
  project?: string
  /** Representative state driving the header dot (aggregate for project groups). */
  state: ContainerState
  containers: DockerContainer[]
}

/** A container counts as "running" when it is actively up (running or restarting);
 *  paused/created/exited/dead all read as stopped for grouping purposes. */
export function isActive(state: ContainerState): boolean {
  return state === 'running' || state === 'restarting'
}

/** Aggregate state for a project header dot: the "most alive" member state wins. */
export function aggregateState(containers: DockerContainer[]): ContainerState {
  const has = (s: ContainerState) => containers.some((c) => c.state === s)
  if (has('running')) return 'running'
  if (has('restarting')) return 'restarting'
  if (has('paused')) return 'paused'
  if (has('created')) return 'created'
  return 'exited'
}

export function groupContainers(containers: DockerContainer[]): ContainerGroup[] {
  const groups: ContainerGroup[] = []

  // Compose projects first, alphabetical, each project → its containers (by service).
  const composed = containers.filter((c) => c.project)
  const projects = [...new Set(composed.map((c) => c.project as string))].sort((a, b) =>
    a.localeCompare(b),
  )
  for (const project of projects) {
    const members = composed
      .filter((c) => c.project === project)
      .sort((a, b) => (a.service ?? a.name).localeCompare(b.service ?? b.name))
    groups.push({
      key: `project:${project}`,
      kind: 'project',
      label: project,
      project,
      state: aggregateState(members),
      containers: members,
    })
  }

  // Everything without a compose project falls into the running/stopped state groups.
  const rest = containers.filter((c) => !c.project)
  const running = rest.filter((c) => isActive(c.state))
  const stopped = rest.filter((c) => !isActive(c.state))
  if (running.length)
    groups.push({
      key: 'running',
      kind: 'state',
      label: 'Running',
      state: 'running',
      containers: running,
    })
  if (stopped.length)
    groups.push({
      key: 'stopped',
      kind: 'state',
      label: 'Stopped',
      state: 'exited',
      containers: stopped,
    })
  return groups
}

/** Filter by a case-insensitive substring over name + image + compose project/service
 *  (empty query → all). Keeps filtering working across grouped and ungrouped alike. */
export function filterContainers(containers: DockerContainer[], query: string): DockerContainer[] {
  const q = query.trim().toLowerCase()
  if (!q) return containers
  return containers.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.image.toLowerCase().includes(q) ||
      (c.project?.toLowerCase().includes(q) ?? false) ||
      (c.service?.toLowerCase().includes(q) ?? false),
  )
}

/** Dot color class per state (theme-aware status tokens, no bespoke colors). */
export function stateDotClass(state: ContainerState): string {
  switch (state) {
    case 'running':
      return 'bg-status-success'
    case 'restarting':
      return 'bg-status-info'
    case 'paused':
    case 'created':
      return 'bg-status-warning'
    case 'exited':
    case 'dead':
    case 'removing':
      return 'bg-status-error'
  }
  return 'bg-text-faint'
}
