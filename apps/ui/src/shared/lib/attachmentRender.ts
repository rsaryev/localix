import type { MessageAttachment } from '@/shared/api/contracts'

/**
 * How a single attachment should be rendered in the transcript: as an inline
 * FIGURE (a real picture or player) or as a compact chip. Pure — no DOM,
 * unit-tested.
 *
 * Every image is a figure, whoever produced it — a screenshot the user pasted
 * reads no worse at size than one a tool returned.
 */
export type AttachmentRenderKind =
  | 'image' // inline image figure
  | 'video' // inline video figure
  | 'audio' // voice-message bubble
  | 'file' // generic download chip
  | 'text' // generic text chip

/** Classify one attachment into its render kind. */
export function attachmentRenderKind(att: MessageAttachment): AttachmentRenderKind {
  if (att.kind === 'image') return 'image'
  if (att.kind === 'video') return 'video'
  if (att.kind === 'audio') return 'audio'
  if (att.kind === 'text') return 'text'
  return 'file'
}

/** True for a large inline figure (image or video) — not a chip. */
export function isFigureRender(kind: AttachmentRenderKind): boolean {
  return kind === 'image' || kind === 'video'
}
