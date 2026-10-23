import { useSyncExternalStore } from 'react'
import { FileDown } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { getFileDropActive, subscribeFileDropActive } from '@/shared/lib/fileDropActive'
import { isDesktop } from '@localixai/kit/environment'
import { DROP_TARGET_HINT } from '@localixai/kit/drop-target'

/** Reactive "an OS file is being dragged over the window" flag (drag-counter backed). */
function useFileDropActive(): boolean {
  return useSyncExternalStore(subscribeFileDropActive, getFileDropActive, () => false)
}

/**
 * A subtle, window-wide drop hint shown while an OS file is dragged anywhere over the
 * app — a dashed viewport ring + a top pill. Purely presentational and
 * `pointer-events-none`, so it never blocks a drop and never competes with the
 * composer's own (more specific "drop to attach") overlay: viewer-format files opened
 * this way land in a viewer tab; a drop ON the composer still attaches to chat.
 */
export function FileDropOverlay() {
  const active = useFileDropActive()
  if (!active) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-(--z-drag-overlay) flex justify-center">
      <div className="absolute inset-2 rounded-xl border-2 border-dashed border-control-border-focus/80" />
      {/* The same hint pill every drop target shows — it was a near-copy with its own border and
          text tone, so the window-wide drop and a pane's drop spoke two dialects. */}
      <div className={cn('absolute top-6 flex items-center gap-2', DROP_TARGET_HINT)}>
        <FileDown className="size-4" />
        {isDesktop
          ? 'Drop to open — files open in the editor, folders as a project'
          : 'Drop to open — PDFs, docs & spreadsheets open in a viewer'}
      </div>
    </div>
  )
}
