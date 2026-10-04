import { useCallback, useEffect, useRef, useState } from 'react'

import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import type { ReasoningEffort } from './reasoning'

const SUCCESS_STATE_MS = 1800

interface UsePromptImproverProps {
  sessionId: string | null
  connectionId: string | null
  model: string
  reasoningEffort: ReasoningEffort
  text: string
  setText: (text: string) => void
}

export function usePromptImprover({
  sessionId,
  connectionId,
  model,
  reasoningEffort,
  text,
  setText,
}: UsePromptImproverProps) {
  const [isImproving, setIsImproving] = useState(false)
  const [didImproveRecently, setDidImproveRecently] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const improvePrompt = useCallback(async () => {
    const prompt = text.trim()
    if (!prompt || !connectionId || !model || isImproving) return false

    setIsImproving(true)
    try {
      const response = await backendClient.improvePrompt({
        sessionId,
        connectionId,
        model,
        reasoningEffort,
        prompt,
      })
      const improved = response.prompt.trim()
      if (!improved) throw new Error('Empty response')

      setText(improved)
      setDidImproveRecently(true)
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setDidImproveRecently(false), SUCCESS_STATE_MS)
      return true
    } catch (error) {
      toast.error('Could not improve the prompt', {
        description: errorMessage(error, '') || undefined,
      })
      return false
    } finally {
      setIsImproving(false)
    }
  }, [connectionId, isImproving, model, reasoningEffort, sessionId, setText, text])

  return { improvePrompt, isImproving, didImproveRecently }
}
