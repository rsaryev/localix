import { useEffect, useState } from 'react'
import type { VfCapture } from '@localixai/visual-feedback/protocol'
import type { MessageAttachment } from '@/shared/api/contracts'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import { previewPickMode } from '../model/previewSelection'
import type { VisualFeedbackBridge } from './useVisualFeedback'

/** Capture identity survives rect updates and note edits; bridge identity does not. */
export function usePreviewFeedbackCapture(
  capture: VfCapture | undefined,
  captureElement: VisualFeedbackBridge['captureElement'],
): { capture: VfCapture | undefined; ready: boolean; asset?: MessageAttachment } {
  const [result, setResult] = useState<{
    capture: VfCapture | undefined
    ready: boolean
    asset?: MessageAttachment
  }>({ capture: undefined, ready: false })
  useEffect(() => {
    setResult({ capture, ready: false })
    if (!capture?.selector || previewPickMode(capture) === 'quick-add') {
      setResult({ capture, ready: true })
      return
    }
    let cancelled = false
    void captureElement(capture.selector)
      .then((img) => {
        if (cancelled) return
        setResult({
          capture,
          ready: true,
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
          setResult({ capture, ready: true })
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
  }, [capture, captureElement])
  return result
}
