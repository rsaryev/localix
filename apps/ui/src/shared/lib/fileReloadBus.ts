import { createEventChannel } from './eventChannel'

/**
 * Tiny pub/sub for "this file changed on disk, reload it". A rename (F2) or an
 * applied review suggestion rewrites files server-side, so every open editor tab
 * showing one of them must re-fetch its content. Lives in shared/lib as the FSD
 * mediator between publishers (inspector FileTab and QuickFixMenu)
 * and the subscriber (inspector useFileEditor).
 */

type Listener = (paths: ReadonlySet<string>) => void

const channel = createEventChannel<[paths: ReadonlySet<string>]>()

/** Announce that the given absolute file paths were rewritten on disk. */
export function publishFilesReloaded(paths: readonly string[]): void {
  if (!paths.length) return
  const set = new Set(paths)
  channel.publish(set)
}

/** Subscribe to disk-change announcements; returns an unsubscribe fn. */
export function onFilesReloaded(listener: Listener): () => void {
  return channel.subscribe(listener)
}
