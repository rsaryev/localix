import type { InstallJob } from '@/shared/api/localModelsApi'
import { formatBytes } from './formatBytes'

/** 0–100, or null when the total is not known yet. */
export function jobPercent(job: Pick<InstallJob, 'received' | 'total'>): number | null {
  if (job.total <= 0) return null
  return Math.min(100, Math.round((job.received / job.total) * 100))
}

/** "1 min left", "40 s left" — or null while there is no rate to go by. */
export function etaLabel(remainingUnits: number, perSecond: number | null): string | null {
  if (!perSecond || perSecond <= 0 || remainingUnits <= 0) return null
  const seconds = Math.ceil(remainingUnits / perSecond)
  if (seconds < 60) return `${seconds} s left`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} min left` : `${Math.round(minutes / 60)} h left`
}

/** One line for a download: "1.2 GB of 3.2 GB · 24 MB/s · 2 min left". */
export function jobLine(job: InstallJob): string {
  if (job.phase === 'queued') return 'Waiting for the download before it'
  if (job.phase === 'verifying') return 'Verifying…'
  if (job.phase === 'failed') return job.error ?? 'The download failed'
  if (job.phase === 'cancelled') return 'Cancelled'
  const parts = [`${formatBytes(job.received)} of ${formatBytes(job.total)}`]
  if (job.rate) parts.push(`${formatBytes(job.rate)}/s`)
  const eta = etaLabel(job.total - job.received, job.rate)
  if (eta) parts.push(eta)
  return parts.join(' · ')
}

export const isActiveJob = (job: InstallJob | undefined): boolean =>
  !!job && (job.phase === 'queued' || job.phase === 'downloading' || job.phase === 'verifying')

/** Where one local model stands, as its row and its details show it. */
export type LocalModelState =
  | { kind: 'available' }
  | { kind: 'downloading'; percent: number | null; job: InstallJob }
  | { kind: 'paused'; percent: number | null }
  | { kind: 'failed'; error: string }
  | { kind: 'installed'; running: boolean }

export function localModelState(input: {
  installed: boolean
  running: boolean
  job: InstallJob | undefined
  paused: { received: number; total: number } | undefined
}): LocalModelState {
  const { job } = input
  if (job && isActiveJob(job)) return { kind: 'downloading', percent: jobPercent(job), job }
  if (input.installed) return { kind: 'installed', running: input.running }
  if (job?.phase === 'failed') return { kind: 'failed', error: job.error ?? 'The download failed' }
  if (input.paused) return { kind: 'paused', percent: jobPercent(input.paused) }
  return { kind: 'available' }
}
