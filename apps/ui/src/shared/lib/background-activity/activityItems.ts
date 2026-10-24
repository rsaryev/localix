import type { MiniAppStoreActivityRecord } from '@localixai/api/client'
import type { LocalModelsStatus } from '@/shared/api/localModelsApi'
import type { PluginUpdatesResponse } from '@/shared/api/plugin-updates-client'
import type { DesktopUpdateState } from '@/shared/hooks/useDesktopUpdate'
import { formatBytes } from '@/shared/lib/formatBytes'
import { isActiveJob, jobLine, jobPercent } from '@/shared/lib/localModelsFormat'

/**
 * EVERYTHING THE APP IS DOING ON ITS OWN, as rows: the jobs in flight (mini app installs, model
 * downloads, the app's own update, plugin updates) and the updates it offers. Pure: the live
 * sources come in (each read on its own poke, `useBackgroundActivity.ts`), the actions go out
 * through `ops`, and nothing here is journal state — a finished job becomes a journal fact,
 * recorded by its owner.
 */

export interface ActivityAction {
  id: string
  label: string
  run: () => unknown
}

export type ActivityKind = 'mini-app' | 'local-model' | 'app-update' | 'plugin'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  name: string
  /** What is happening, in a few words: "Downloading · 1.2 MB of 4 MB". */
  status: string
  /** 0–100, or null while how far it is cannot be said (the bar is then indeterminate). */
  percent: number | null
  state: 'waiting' | 'running' | 'paused'
  /** A mini app's icon, as the host serves it. */
  icon?: string
  actions: ActivityAction[]
}

/** An update the app offers. One per kind; the app's own always comes first. */
export interface UpdateOffer {
  id: 'app' | 'mini-apps' | 'plugins'
  title: string
  detail: string
  /** What the offer is about; a dismissal holds until it changes (`dismissals.ts`). */
  fingerprint: string
  /** While the update runs: how far it is. */
  running?: { percent: number | null; status: string }
  action?: ActivityAction
}

export interface ActivitySources {
  miniApps?: MiniAppStoreActivityRecord | null
  localModels?: LocalModelsStatus | null
  app?: DesktopUpdateState | null
  plugins?: PluginUpdatesResponse | null
}

export interface ActivityOps {
  openStore: () => void
  pauseModel: (id: string) => unknown
  resumeModel: (id: string) => unknown
  cancelModel: (id: string) => unknown
  updateMiniApps: () => unknown
  updatePlugins: () => unknown
  openPlugins: () => void
  /** Absent where nothing can restart the app (a browser window). */
  restartToUpdate?: () => void
}

type MiniAppJob = MiniAppStoreActivityRecord['jobs'][number]

const percentOf = (received?: number, total?: number) =>
  total && total > 0 ? Math.min(100, Math.round(((received ?? 0) / total) * 100)) : null

/** "1 update", "3 updates", after the thing updated. */
const count = (n: number, thing: string) => `${n} ${thing} update${n === 1 ? '' : 's'}`

/** "Git", "Git and Kanban", "Git, Documents and Kanban". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

function miniAppStatus(job: MiniAppJob): string {
  const update = job.kind === 'update'
  if (job.phase === 'queued') return update ? 'Waiting to update' : 'Waiting to install'
  if (job.phase === 'downloading') {
    const what = update && job.version ? `Downloading ${job.version}` : 'Downloading'
    return job.total
      ? `${what} · ${formatBytes(job.received ?? 0)} of ${formatBytes(job.total)}`
      : what
  }
  return update ? 'Updating' : 'Installing'
}

function miniAppItems(activity: MiniAppStoreActivityRecord, ops: ActivityOps): ActivityItem[] {
  return activity.jobs.map((job) => ({
    id: `mini-app:${job.name}`,
    kind: 'mini-app',
    name: job.displayName ?? job.name,
    status: miniAppStatus(job),
    percent: job.phase === 'downloading' ? percentOf(job.received, job.total) : null,
    state: job.phase === 'queued' ? 'waiting' : 'running',
    icon: job.icon,
    actions: [{ id: 'store', label: 'Open the store', run: ops.openStore }],
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

const ACTIVE_PLUGIN_PHASES = new Set(['checking', 'downloading', 'installing'])
const PLUGIN_PHASE_LABEL = {
  checking: 'Checking',
  downloading: 'Downloading',
  installing: 'Installing',
}
const pluginName = (id: string) => id.split('@')[0] || id

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

function miniAppOffer(activity: MiniAppStoreActivityRecord, ops: ActivityOps): UpdateOffer | null {
  const running = activity.jobs.filter((job) => job.kind === 'update')
  const all = [
    ...activity.updates.map((u) => ({ name: u.name, label: u.displayName ?? u.name, to: u.to })),
    ...running.map((j) => ({ name: j.name, label: j.displayName ?? j.name, to: j.version ?? '' })),
  ].sort((a, b) => a.name.localeCompare(b.name))
  if (all.length === 0) return null
  const first = running[0]
  const percent = first?.phase === 'downloading' ? percentOf(first.received, first.total) : null
  return {
    id: 'mini-apps',
    title: count(all.length, 'mini app'),
    detail: joinNames(all.map((u) => u.label)),
    fingerprint: all.map((u) => `${u.name}@${u.to}`).join(','),
    ...(first
      ? {
          running: {
            percent,
            status: `Updating ${first.displayName ?? first.name}${percent === null ? '' : ` · ${percent}%`}`,
          },
        }
      : { action: { id: 'update-all', label: 'Update all', run: ops.updateMiniApps } }),
  }
}

function pluginOffer(plugins: PluginUpdatesResponse, ops: ActivityOps): UpdateOffer | null {
  const active = plugins.jobs.filter((job) => ACTIVE_PLUGIN_PHASES.has(job.phase))
  if (active.length > 0) {
    const done = plugins.jobs.filter((job) => job.phase === 'done').length
    return {
      id: 'plugins',
      title: count(active.length, 'plugin'),
      detail: joinNames(active.map((job) => pluginName(job.id))),
      fingerprint: active
        .map((job) => job.id)
        .sort()
        .join(','),
      running: {
        percent: Math.round((done / plugins.jobs.length) * 100),
        status: `Updating plugins · ${done} of ${plugins.jobs.length}`,
      },
    }
  }
  if (plugins.available.length === 0) return null
  return {
    id: 'plugins',
    title: count(plugins.available.length, 'plugin'),
    detail: joinNames(plugins.available.map((offer) => offer.name)),
    fingerprint: plugins.available
      .map((offer) => `${offer.id}@${offer.to}`)
      .sort()
      .join(','),
    action: { id: 'update-all', label: 'Update all', run: ops.updatePlugins },
  }
}

export function buildActivity(
  sources: ActivitySources,
  ops: ActivityOps,
): { items: ActivityItem[]; updates: UpdateOffer[] } {
  const items: ActivityItem[] = []
  const updates: UpdateOffer[] = []
  const { app, miniApps, localModels, plugins } = sources
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
  if (miniApps) {
    items.push(...miniAppItems(miniApps, ops))
    const offer = miniAppOffer(miniApps, ops)
    if (offer) updates.push(offer)
  }
  if (localModels) items.push(...modelItems(localModels, ops))
  if (plugins) {
    for (const job of plugins.jobs) {
      if (!ACTIVE_PLUGIN_PHASES.has(job.phase)) continue
      items.push({
        id: `plugin:${job.id}`,
        kind: 'plugin',
        name: pluginName(job.id),
        status: PLUGIN_PHASE_LABEL[job.phase as keyof typeof PLUGIN_PHASE_LABEL],
        percent: null,
        state: 'running',
        actions: [{ id: 'plugins', label: 'Open plugin settings', run: ops.openPlugins }],
      })
    }
    const offer = pluginOffer(plugins, ops)
    if (offer) updates.push(offer)
  }
  return { items, updates }
}
