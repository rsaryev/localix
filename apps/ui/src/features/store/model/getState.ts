import { hasUpdate, isActiveJob, type Listing, type StoreJob } from '@localixai/store'
import type { GetState } from '@localixai/kit/get-button'

/** How far a job is, 0–100, or null while it cannot say (waiting, unpacking). */
export function jobPercent(job: StoreJob): number | null {
  if (job.phase !== 'downloading' || !job.total) return null
  return Math.min(100, Math.round(((job.received ?? 0) / job.total) * 100))
}

const JOB_WORDS = { install: 'Installing', update: 'Updating', remove: 'Removing' } as const

/**
 * What the one install control shows for a listing (`docs/internals/store.md`, "Get button"):
 * its job while one runs, Retry once it failed, Update when a newer version is offered, Open once
 * installed with something to open (`canOpen`, else Installed), and Get before that.
 */
export function getStateOf(listing: Listing, canOpen = false): GetState {
  const job = listing.job
  if (job && isActiveJob(job))
    return {
      kind: 'progress',
      percent: jobPercent(job),
      label: job.phase === 'queued' ? 'Waiting to install' : JOB_WORDS[job.action],
    }
  if (job?.phase === 'failed') return { kind: 'retry' }
  if (hasUpdate(listing)) return { kind: 'update' }
  if (listing.installs.length > 0) return canOpen ? { kind: 'open' } : { kind: 'installed' }
  return { kind: 'get' }
}
