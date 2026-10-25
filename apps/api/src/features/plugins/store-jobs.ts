import type { StoreJob } from '@localixai/store'

import { errorMessage } from '../../lib/errors'
import type { PluginUpdatesResponse } from './contracts-updates'

/**
 * THE STORE'S PLUGIN JOBS: an install or update the Store queued, shown on its listing from
 * queued to done or failed, one at a time per plugin. The plugin service installs synchronously,
 * so the job is the Store's own; an update the background pass runs (`plugin-updates.ts`) shows
 * through the same field. In memory, like the mini app store's installs.
 */
const PHASES: Record<PluginUpdatesResponse['jobs'][number]['phase'], StoreJob['phase']> = {
  checking: 'queued',
  downloading: 'downloading',
  installing: 'installing',
  done: 'done',
  failed: 'failed',
}

const FINISHED = new Set<StoreJob['phase']>(['done', 'failed'])

export function createPluginStoreJobs(changed: () => void) {
  const jobs = new Map<string, StoreJob>()
  const running = new Set<Promise<unknown>>()

  return {
    /** Run `work` as `id`'s job; returns once it is queued. A plugin runs one job at a time. */
    run(id: string, action: StoreJob['action'], work: () => Promise<unknown>) {
      const current = jobs.get(id)
      if (current && !FINISHED.has(current.phase)) return
      jobs.set(id, { action, phase: 'downloading' })
      changed()
      const done = work()
        .then(() => jobs.set(id, { action, phase: 'done' }))
        .catch((error: unknown) =>
          jobs.set(id, { action, phase: 'failed', error: errorMessage(error) }),
        )
        .finally(() => {
          running.delete(done)
          changed()
        })
      running.add(done)
    },

    /**
     * The job a listing shows: the Store's own while it runs, else the update pass's, else how the
     * Store's own last one ended.
     */
    of(id: string, updates: PluginUpdatesResponse): StoreJob | undefined {
      const own = jobs.get(id)
      if (own && !FINISHED.has(own.phase)) return own
      const pass = updates.jobs.find((job) => job.id === id)
      return pass
        ? {
            action: 'update',
            phase: PHASES[pass.phase],
            ...(pass.error ? { error: pass.error } : {}),
          }
        : own
    },

    async settled(): Promise<void> {
      while (running.size > 0) await Promise.all(running)
    },
  }
}
