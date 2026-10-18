/**
 * Downloads, one at a time: each job reports bytes and a recent rate for its progress bar, checks
 * the disk first, installs the runtime before its first model, and can be paused (its files stay
 * and `start` resumes it) or cancelled (its files go). A second request waits as `queued`.
 */
import type { InstallJob, LocalModelSpec } from './contracts'
import { ensureDiskSpace } from './disk'
import {
  installModel,
  installRuntime,
  isRuntimeInstalled,
  pendingModelBytes,
  discardDownload,
  markBackground,
  markResumeOnStart,
  type InstallPaths,
} from './installer'
import type { RuntimeBuild } from './runtime'

const RATE_WINDOW_MS = 4000

type Job = InstallJob & {
  spec: LocalModelSpec
  controller: AbortController
  done: Promise<void>
  /** Why it is being stopped: a pause keeps the files, a cancel deletes them. */
  stop?: 'pause' | 'cancel'
}

export function createInstallQueue(deps: {
  paths: InstallPaths
  build: RuntimeBuild | null
  /** Every progress tick. */
  notify: () => void
  /** A job finished; `runtimeAdded` when it also installed the runtime. */
  installed: (spec: LocalModelSpec, runtimeAdded: boolean) => Promise<void>
  /** A job stopped (paused or cancelled) and its files were dealt with. */
  stopped: () => Promise<void>
  log?: (event: string, fields: Record<string, unknown>) => void
}) {
  const { paths, build } = deps
  const jobs = new Map<string, Job>()
  let queue: Promise<unknown> = Promise.resolve()

  async function run(job: Job, spec: LocalModelSpec) {
    const { signal } = job.controller
    if (!build) throw new Error('Local models have no runtime build for this computer')
    const samples: Array<{ at: number; bytes: number }> = []
    let base = 0
    const onProgress = (p: { received: number }) => {
      job.phase = 'downloading'
      job.received = base + p.received
      const now = Date.now()
      samples.push({ at: now, bytes: job.received })
      while (samples.length > 1 && now - samples[0]!.at > RATE_WINDOW_MS) samples.shift()
      const first = samples[0]!
      job.rate = now > first.at ? ((job.received - first.bytes) / (now - first.at)) * 1000 : null
      deps.notify()
    }
    const runtimeMissing = !(await isRuntimeInstalled(paths, build))
    if (runtimeMissing) {
      await installRuntime(paths, build, { signal, onProgress })
      base += build.archive.bytes
    }
    await installModel(paths, spec, {
      signal,
      onProgress,
      onFileDone: () => {
        base = job.received
      },
    })
    job.phase = 'verifying'
    deps.notify()
    return runtimeMissing
  }

  async function settleStopped(job: Job) {
    jobs.delete(job.modelId)
    if (job.stop === 'cancel') await discardDownload(paths, job.modelId)
    await deps.stopped()
    deps.notify()
  }

  const view = (job: Job): InstallJob => {
    const { controller: _c, done: _d, stop: _s, spec: _spec, ...rest } = job
    return rest
  }

  return {
    /**
     * Queue a download (or return the one already running for this model). A `background` one
     * was not asked for (a model fetched ahead of need); a person asking for it promotes it.
     */
    start(spec: LocalModelSpec, options: { background?: boolean } = {}): Promise<void> {
      const background = options.background === true
      const existing = jobs.get(spec.id)
      if (existing && (existing.phase === 'queued' || existing.phase === 'downloading')) {
        if (!background && existing.background) {
          existing.background = false
          void markBackground(paths, spec.id, false)
          deps.notify()
        }
        return existing.done
      }
      const controller = new AbortController()
      const job: Job = {
        spec,
        modelId: spec.id,
        label: spec.label,
        background,
        phase: 'queued',
        received: 0,
        total: 0,
        rate: null,
        error: null,
        controller,
        done: Promise.resolve(),
      }
      jobs.set(spec.id, job)
      deps.notify()
      job.done = (queue = queue.then(async () => {
        if (controller.signal.aborted) return settleStopped(job)
        try {
          job.total =
            (await pendingModelBytes(paths, spec)) +
            (build && !(await isRuntimeInstalled(paths, build)) ? build.archive.bytes : 0)
          await ensureDiskSpace(paths.root, job.total)
          // Said on disk, so a pause or a restart keeps it as quiet (or not) as it began.
          await markBackground(paths, spec.id, job.background)
          const runtimeAdded = await run(job, spec)
          // Listed as installed before the job leaves: a waiter never sees neither.
          await deps.installed(spec, runtimeAdded)
          jobs.delete(spec.id)
          deps.log?.('local_models.installed', { model: spec.id, bytes: spec.bytes })
        } catch (err) {
          if (controller.signal.aborted) return settleStopped(job)
          job.phase = 'failed'
          job.error = err instanceof Error ? err.message : String(err)
          deps.log?.('local_models.install_failed', { model: spec.id, error: job.error })
        }
        deps.notify()
      })) as Promise<void>
      return job.done
    },

    job(modelId: string): InstallJob | null {
      const job = jobs.get(modelId)
      return job ? view(job) : null
    },
    list: (): InstallJob[] => [...jobs.values()].map(view),
    has: (modelId: string) => jobs.has(modelId),

    /** Stop a job; `pause` keeps what it fetched, `cancel` deletes it. False when none runs. */
    async stop(modelId: string, how: 'pause' | 'cancel'): Promise<boolean> {
      const job = jobs.get(modelId)
      if (!job) return false
      job.stop = how
      job.controller.abort()
      await job.done
      return true
    },

    /** Forget a job without settling it (its model is being removed). */
    drop(modelId: string) {
      jobs.get(modelId)?.controller.abort()
      jobs.delete(modelId)
    },

    /** Quitting: every running download is paused, so it resumes next time. */
    pauseAll() {
      for (const job of jobs.values()) {
        job.stop = 'pause'
        markResumeOnStart(paths, job.modelId)
        job.controller.abort()
      }
    },
  }
}

export type InstallQueue = ReturnType<typeof createInstallQueue>
