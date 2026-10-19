/**
 * Waiting for a model: resolve once it is installed, waiting out its download; reject with what
 * a person can do when it is not coming — a paused or failed download, or none at all.
 */
import type { InstallJob, LocalModelSpec } from './contracts'

export function whenInstalled(
  state: {
    isInstalled: (modelId: string) => boolean
    job: (modelId: string) => InstallJob | null
    paused: (modelId: string) => { spec: LocalModelSpec; received: number } | undefined
    subscribe: (listener: () => void) => () => void
  },
  modelId: string,
  label: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let off = () => {}
    const finish = (err?: Error) => {
      off()
      signal?.removeEventListener('abort', onAbort)
      if (err) reject(err)
      else resolve()
    }
    const onAbort = () => finish(new DOMException('Cancelled', 'AbortError'))
    const check = () => {
      if (state.isInstalled(modelId)) return finish()
      const job = state.job(modelId)
      if (job && job.phase !== 'failed') return
      const stopped = state.paused(modelId)
      finish(
        new Error(
          job?.phase === 'failed'
            ? `${label} could not be downloaded (${job.error ?? 'the download failed'}). Try again in the model picker.`
            : stopped
              ? `${label} is paused at ${Math.round((stopped.received / Math.max(1, stopped.spec.bytes)) * 100)}%. Resume its download in the model picker.`
              : `${label} is not downloaded. Pick it in the model picker to download it.`,
        ),
      )
    }
    off = state.subscribe(check)
    signal?.addEventListener('abort', onAbort, { once: true })
    check()
  })
}
