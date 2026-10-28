import { useEffect, useMemo, useState } from 'react'
import type { VfCapture } from '@localixai/visual-feedback/protocol'
import type { MessageAttachment } from '@/shared/api/contracts'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import { previewPickMode } from '../model/previewSelection'
import type { VisualFeedbackBridge } from './useVisualFeedback'

export interface PreviewFeedbackCapture {
  capture: VfCapture | undefined
  ready: boolean
  asset?: MessageAttachment
  /** The screenshot could not be taken; the comment goes without one. */
  failed?: boolean
}

/** Capture identity survives rect updates and note edits; bridge identity does not. */
export function usePreviewFeedbackCapture(
  capture: VfCapture | undefined,
  captureElement: VisualFeedbackBridge['captureElement'],
): PreviewFeedbackCapture {
  const [result, setResult] = useState<PreviewFeedbackCapture>({
    capture: undefined,
    ready: false,
  })
  // No selector, or a quick add: nothing to take a picture of, so the capture is ready as it is.
  const immediate = !capture?.selector || previewPickMode(capture) === 'quick-add'
  useEffect(() => {
    if (immediate || !capture?.selector) return
    let cancelled = false
    void captureElement(capture.selector)
      .then((img) => {
        if (cancelled) return
        setResult({
          capture,
          ready: true,
          // The page answered without a picture (an element it could not render): said in the
          // card, so "no screenshot" is not mistaken for one still coming.
          ...(img ? {} : { failed: true }),
          ...(img
            ? {
                asset: {
                  kind: 'image',
                  mediaType: img.mediaType,
                  data: img.data,
                  name: 'screenshot.jpg',
                  size: Math.round((img.data.length * 3) / 4),
                },
              }
            : {}),
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({ capture, ready: true, failed: true })
          toast.warning('Could not capture a screenshot of the selection', {
            description: [errorMessage(error, ''), 'The selected context was attached without it.']
              .filter(Boolean)
              .join(' '),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [capture, captureElement, immediate])
  // A result belongs to the capture it was taken for; until the new one lands, it is not ready.
  return useMemo(() => {
    if (immediate) return { capture, ready: true }
    return result.capture === capture ? result : { capture, ready: false }
  }, [immediate, capture, result])
}
