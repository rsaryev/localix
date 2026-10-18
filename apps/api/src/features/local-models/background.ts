/**
 * Models fetched ahead of need: each feature declares the local models it runs on while it is
 * on (semantic search, its embedding model), and every one of them not on this computer
 * downloads quietly — the way an operating system fetches its on-device models after setup.
 * Until one is here, its feature works without it (search answers from words alone).
 *
 * Reconciled, not remembered: a wanted model that was removed downloads again; one no longer
 * wanted (its feature turned off) pauses, keeping what it fetched for when it is wanted again.
 * A person who cancels a background download is heard until what is wanted changes; a failed
 * one waits for a retry.
 */
import type { InstallJob, LocalModelSpec } from './contracts'

export function createBackgroundDownloads(deps: {
  isInstalled: (modelId: string) => boolean
  jobs: () => readonly InstallJob[]
  start: (spec: LocalModelSpec, options: { background: true }) => Promise<void>
  pause: (modelId: string) => Promise<void>
  log?: (event: string, fields: Record<string, unknown>) => void
}) {
  const demands = new Map<string, () => readonly LocalModelSpec[]>()
  const declined = new Set<string>()
  let wantedKey = ''

  function wanted(): Map<string, LocalModelSpec> {
    const out = new Map<string, LocalModelSpec>()
    for (const demand of demands.values()) for (const spec of demand()) out.set(spec.id, spec)
    return out
  }

  /** Start what is wanted and missing, pause background downloads no longer wanted. */
  function reconcile(options: { retry?: boolean } = {}) {
    const want = wanted()
    const key = [...want.keys()].sort().join('\n')
    if (key !== wantedKey || options.retry) declined.clear()
    wantedKey = key
    const jobs = new Map(deps.jobs().map((job) => [job.modelId, job]))
    for (const spec of want.values()) {
      if (deps.isInstalled(spec.id) || declined.has(spec.id)) continue
      const job = jobs.get(spec.id)
      if (job && (job.phase !== 'failed' || !options.retry)) continue
      deps.log?.('local_models.background_download', { model: spec.id })
      void deps.start(spec, { background: true })
    }
    for (const job of jobs.values()) {
      const running = job.phase === 'queued' || job.phase === 'downloading'
      if (job.background && running && !want.has(job.modelId)) void deps.pause(job.modelId)
    }
  }

  return {
    /**
     * A feature's wanted models, read on every reconcile; `owner` names the feature. Returns
     * the undeclaration.
     */
    declare(owner: string, models: () => readonly LocalModelSpec[]): () => void {
      demands.set(owner, models)
      reconcile()
      return () => {
        demands.delete(owner)
        reconcile()
      }
    },
    reconcile,
    /** A person cancelled `modelId`'s background download: not restarted while wanted alike. */
    decline(modelId: string) {
      declined.add(modelId)
    },
  }
}

export type BackgroundDownloads = ReturnType<typeof createBackgroundDownloads>
