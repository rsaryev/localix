import { buildPreviewCommentsMessage } from '@localixai/visual-feedback/host'
import type { VfCapture } from '@localixai/visual-feedback/protocol'
import type { MessageAttachment } from '@/shared/api/contracts'
import { reviewCommentBinding } from '@/shared/lib/reviewCommentBinding'

/** Immutable review evidence, budgeted and captured by the normal context pipeline. */
export function previewFeedbackBinding(input: {
  id: string
  capture: VfCapture
  note: string
  url: string
  servedFile?: string
  viewport: { width: number; height: number }
  assets?: MessageAttachment[]
}) {
  const binding = reviewCommentBinding({
    token: `preview-${input.id}`,
    label: `Preview: ${input.capture.summary}`,
    content: buildPreviewCommentsMessage([{ capture: input.capture, note: input.note }], input),
    ...(input.assets?.length ? { assets: input.assets } : {}),
  })
  return {
    ...binding,
    target: {
      ...binding.target,
      attributes: {
        ...binding.target.attributes,
        feedbackVersion: 1,
        feedbackNote: input.note,
        feedbackSummary: binding.target.label,
      },
    },
  }
}
