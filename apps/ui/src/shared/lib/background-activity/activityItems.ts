import type { ListingRef, PackageKind, StoreActivity } from '@localixai/store'
import type { LocalModelsStatus } from '@/shared/api/localModelsApi'
import type { DesktopUpdateState } from '@/shared/hooks/useDesktopUpdate'
import { formatBytes } from '@/shared/lib/formatBytes'
import { isActiveJob, jobLine, jobPercent } from '@/shared/lib/localModelsFormat'
import type { StoreTarget } from '@/shared/lib/openStore'

/**
 * EVERYTHING THE APP IS DOING ON ITS OWN, as rows: the jobs in flight (the Store's installs,
 * updates and removals of every package kind, model downloads, the app's own update) and the
 * updates it offers. Pure: the live sources come in (each read on its own poke,
 * `useBackgroundActivity.ts`), the actions go out through `ops`, and nothing here is journal
 * state — a finished job becomes a journal fact, recorded by its owner.
 */

export interface ActivityAction {
  id: string
  label: string
  run: () => unknown
}

export type ActivityKind = 'package' | 'local-model' | 'app-update'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  name: string
  /** What is happening, in a few words: "Downloading · 1.2 MB of 4 MB". */
  status: string
  /** 0–100, or null while how far it is cannot be said (the bar is then indeterminate). */
  percent: number | null
  state: 'waiting' | 'running' | 'paused'
  /** A package's icon, as the host serves it. */
  icon?: string
  actions: ActivityAction[]
}

/** An update the app offers: its own, and the Store's packages together. The app's comes first. */
export interface UpdateOffer {
  id: 'app' | 'store'
  title: string
  detail: string
  /** What the offer is about; a dismissal holds until it changes (`dismissals.ts`). */
  fingerprint: string
  /** While the update runs: how far it is. */
  running?: { percent: number | null; status: string }
  action?: ActivityAction
}

export interface ActivitySources {
  /** The Store's jobs and updates, every kind's (`/rpc/store/activity`). */
  store?: StoreActivity | null
  localModels?: LocalModelsStatus | null
  app?: DesktopUpdateState | null
}

export interface ActivityOps {
  openStore: (target?: StoreTarget) => void
  pauseModel: (id: string) => unknown
  resumeModel: (id: string) => unknown
  cancelModel: (id: string) => unknown
  /** Update all: every install the Store offers a newer version of. */
  updateStore: () => unknown
  /** Absent where nothing can restart the app (a browser window). */
  restartToUpdate?: () => void
}

type StoreJob = StoreActivity['jobs'][number]

const keyOf = (ref: ListingRef) => `${ref.kind}:${ref.id}`

/** How a package kind is named in a count: "2 mini app updates". */
const KIND_NOUN: Record<PackageKind, string> = {
  'mini-app': 'mini app',
  plugin: 'plugin',
  'mcp-server': 'MCP server',
  skill: 'skill',
  agent: 'agent',
}

const percentOf = (received?: number, total?: number) =>
  total && total > 0 ? Math.min(100, Math.round(((received ?? 0) / total) * 100)) : null

/** "1 plugin update", "3 updates": the kind is named when every update is of it. */
function updatesTitle(kinds: readonly PackageKind[]): string {
  const n = kinds.length
  const kind = kinds.every((each) => each === kinds[0]) ? `${KIND_NOUN[kinds[0]!]} ` : ''
  return `${n} ${kind}update${n === 1 ? '' : 's'}`
}

/** "Git", "Git and Kanban", "Git, Documents and Kanban". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

const WAITING = {
  install: 'Waiting to install',
  update: 'Waiting to update',
  remove: 'Waiting to remove',
} as const
const WORKING = { install: 'Installing', update: 'Updating', remove: 'Removing' } as const

function jobStatus(job: StoreJob): string {
  if (job.phase === 'queued') return WAITING[job.action]
  if (job.phase === 'downloading') {
    const what =
      job.action === 'update' && job.version ? `Downloading ${job.version}` : 'Downloading'
    return job.total
      ? `${what} · ${formatBytes(job.received ?? 0)} of ${formatBytes(job.total)}`
      : what
  }
  return WORKING[job.action]
}

function storeItems(activity: StoreActivity, ops: ActivityOps): ActivityItem[] {
  return activity.jobs.map((job) => ({
    id: keyOf(job.ref),
    kind: 'package',
    name: job.displayName,
    status: jobStatus(job),
    percent: job.phase === 'downloading' ? percentOf(job.received, job.total) : null,
    state: job.phase === 'queued' ? 'waiting' : 'running',
    icon: job.icon,
    actions: [
      { id: 'store', label: 'Open in the Store', run: () => ops.openStore({ ref: job.ref }) },
    ],
  }))
}

function modelItems(status: LocalModelsStatus, ops: ActivityOps): ActivityItem[] {
  const downloads: ActivityItem[] = status.jobs.filter(isActiveJob).map((job) => ({
    id: `local-model:${job.modelId}`,
    kind: 'local-model',
    name: job.label,
    status: jobLine(job),
    percent: job.phase === 'downloading' ? jobPercent(job) : null,
    state: job.phase === 'queued' ? 'waiting' : 'running',
    actions: [
      { id: 'pause', label: 'Pause download', run: () => ops.pauseModel(job.modelId) },
      { id: 'cancel', label: 'Cancel download', run: () => ops.cancelModel(job.modelId) },
    ],
  }))
  const paused: ActivityItem[] = status.paused.map((p) => {
    const percent = jobPercent(p)
    return {
      id: `local-model:${p.modelId}`,
      kind: 'local-model',
      name: p.label,
      status: percent === null ? 'Paused' : `Paused · ${percent}%`,
      percent,
      state: 'paused',
      actions: [
        { id: 'resume', label: 'Resume download', run: () => ops.resumeModel(p.modelId) },
        { id: 'cancel', label: 'Cancel download', run: () => ops.cancelModel(p.modelId) },
      ],
    }
  })
  return [...downloads, ...paused]
}

function appOffer(app: DesktopUpdateState, ops: ActivityOps): UpdateOffer {
  return {
    id: 'app',
    title: `Localix ${app.latestVersion}`,
    detail: `you have ${app.currentVersion}`,
    fingerprint: app.latestVersion ?? '',
    ...(app.installing ? { running: { percent: app.percent, status: app.message } } : {}),
    ...(ops.restartToUpdate && !app.installing
      ? { action: { id: 'restart', label: 'Restart to update', run: ops.restartToUpdate } }
      : {}),
  }
}

/** The Store's updates as one offer: Update all, or how far the running update is. */
function storeOffer(activity: StoreActivity, ops: ActivityOps): UpdateOffer | null {
  const running = activity.jobs.filter((job) => job.action === 'update')
  const all = [
    ...activity.updates.map((u) => ({ ref: u.ref, label: u.displayName, to: u.to })),
    ...running.map((j) => ({ ref: j.ref, label: j.displayName, to: j.version ?? '' })),
  ].sort((a, b) => keyOf(a.ref).localeCompare(keyOf(b.ref)))
  if (all.length === 0) return null
  const first = running[0]
  const percent = first?.phase === 'downloading' ? percentOf(first.received, first.total) : null
  return {
    id: 'store',
    title: updatesTitle(all.map((u) => u.ref.kind)),
    detail: joinNames(all.map((u) => u.label)),
    fingerprint: all.map((u) => `${keyOf(u.ref)}@${u.to}`).join(','),
    ...(first
      ? {
          running: {
            percent,
            status: `Updating ${first.displayName}${percent === null ? '' : ` · ${percent}%`}`,
          },
        }
      : { action: { id: 'update-all', label: 'Update all', run: ops.updateStore } }),
  }
}

export function buildActivity(
  sources: ActivitySources,
  ops: ActivityOps,
): { items: ActivityItem[]; updates: UpdateOffer[] } {
  const items: ActivityItem[] = []
  const updates: UpdateOffer[] = []
  const { app, store, localModels } = sources
  if (app?.available) {
    updates.push(appOffer(app, ops))
    if (app.installing)
      items.push({
        id: 'app-update',
        kind: 'app-update',
        name: `Localix ${app.latestVersion}`,
        status: app.message,
        percent: app.percent,
        state: 'running',
        actions: [],
      })
  }
  if (store) {
    items.push(...storeItems(store, ops))
    const offer = storeOffer(store, ops)
    if (offer) updates.push(offer)
  }
  if (localModels) items.push(...modelItems(localModels, ops))
  return { items, updates }
}
