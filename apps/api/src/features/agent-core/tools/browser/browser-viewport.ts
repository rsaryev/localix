import type { PreviewCommand } from '../preview/preview-control'

type Size = { width: number; height: number }

/**
 * The fixed viewport this run asked each tab for. A tab is responsive (fits the person's pane)
 * unless the agent set a size for an explicit width check, and the size belongs to the TAB, not
 * to the host that happened to apply it: a later command may be answered by another renderer of
 * the same tab (the visible pane, an off-screen host, another window), which never saw the
 * `viewport` command. Carrying the size on every command lets whichever host claims it apply the
 * same frame before it runs, so a `snapshot` after `viewport 320×740` measures 320×740.
 */
export function createViewportMemory() {
  const fixed = new Map<string, Size>()
  return {
    /** `null` (or an `open` without a size) returns the tab to responsive. */
    remember(previewId: string | undefined, viewport: Size | null | undefined): void {
      if (!previewId) return
      if (viewport) fixed.set(previewId, viewport)
      else fixed.delete(previewId)
    },
    /** The command with the tab's remembered size, unless it names its own. */
    apply(command: PreviewCommand): PreviewCommand {
      const size = command.previewId ? fixed.get(command.previewId) : undefined
      if (!size || command.viewport !== undefined || command.action === 'history') return command
      return { ...command, viewport: size }
    },
    /** A reminder that the person's pane is pinned until the agent resets it. */
    note(previewId: string | undefined): string {
      const size = previewId ? fixed.get(previewId) : undefined
      return size
        ? `\n\n[Fixed viewport ${size.width} × ${size.height} is applied to this tab. When the width check is done, reset it with {"action":"viewport","viewport":null} so the Browser fits the pane again.]`
        : ''
    },
  }
}
