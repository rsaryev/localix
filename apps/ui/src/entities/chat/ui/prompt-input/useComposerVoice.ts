import { useCallback } from 'react'

import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

import { useVoiceRecorder } from '../../model/useVoiceRecorder'

/**
 * The composer's microphone. FOCUS-gated on purpose: a live microphone belongs to the composer
 * you are typing in, not to every warm-mounted one that happens to be visible.
 */
export function useComposerVoice(input: {
  isFocused: boolean
  onAddVoice?: (blob: Blob, durationMs: number) => void
  /** Connection, model and write access are all present. */
  canCompose: boolean
  allowAudio: boolean
}) {
  const { isFocused, onAddVoice } = input
  const recorder = useVoiceRecorder(isFocused)
  const canRecord = Boolean(
    onAddVoice && recorder.isSupported && input.canCompose && input.allowAudio,
  )
  const handleMicClick = useCallback(() => {
    if (recorder.isRecording) {
      void recorder.stop().then((rec) => {
        if (rec) onAddVoice?.(rec.blob, rec.durationMs)
      })
    } else {
      // "Microphone access denied" was asserted for EVERY start failure — a busy device and
      // a missing recorder both read as a permission refusal.
      void recorder.start().catch((err: unknown) =>
        toast.error('Could not start recording', {
          description: errorMessage(err, 'The microphone may be denied, missing, or in use.'),
        }),
      )
    }
  }, [recorder, onAddVoice])
  return { recorder, canRecord, handleMicClick }
}
