import type { VfCapture } from '@localixai/visual-feedback/protocol'

/**
 * How a just-made preview pick should be handled by the host overlay:
 * - `quick-add` — a plain text selection: a single "Add to chat" button drops
 *   the selected text straight into the composer draft (no note, no screenshot).
 * - `comment` — every other pick (element / empty-area / multi-element): the full
 *   note + auto-screenshot comment composer.
 */
export type PreviewPickMode = 'quick-add' | 'comment'

/** Decide the pick mode from the capture (text selection ⇒ quick-add, else comment). */
export function previewPickMode(capture: Pick<VfCapture, 'kind' | 'text'>): PreviewPickMode {
  if (capture.kind === 'text' && (capture.text?.trim().length ?? 0) > 0) return 'quick-add'
  return 'comment'
}

/** The (trimmed) text a text-selection quick-add drops into the composer. */
export function quickAddText(capture: Pick<VfCapture, 'text'>): string {
  return capture.text?.trim() ?? ''
}
