import { useMemo } from 'react'

import { loadPromptHistory } from '../../model/persistence'
import { useStreamTip } from '../../model/streamTips'
import type { TipContext } from '../../model/tipSelection'
import { useTipSignals } from '../../model/tipSignals'
import { useComposerTips } from '../../model/useComposerTips'
import { useInlineCompletionTip } from '../../model/useInlineCompletionTip'
import type { PromptInputProps } from './promptInputProps'

interface ComposerStreamTipOptions {
  activeSessionId: string | null
  isFocused: boolean
  /** Whether the tip strip is up at all (focused, not awaiting an answer). */
  active: boolean
  /** Whether a turn is streaming: times `run-long` and brings a hidden strip back. */
  running: boolean
  /** Whether the empty composer may surface the one-shot inline-completion hint. */
  idleDraft: boolean
  usage: PromptInputProps['usage']
  contextDiagnostics: PromptInputProps['contextDiagnostics']
  contextWindow: number | undefined
  tipContext: PromptInputProps['tipContext']
}

/** The rotating tip shown above the focused composer, between turns and while one streams. */
export function useComposerStreamTip({
  activeSessionId,
  isFocused,
  active,
  running,
  idleDraft,
  usage,
  contextDiagnostics,
  contextWindow,
  tipContext,
}: ComposerStreamTipOptions) {
  // Gates the one-shot inline-completion hint so it lands after a first exchange, not in a
  // brand-new user's face. Read once.
  const hasSentBefore = useMemo(() => loadPromptHistory().length > 0, [])
  const scopeTips = useComposerTips(activeSessionId, isFocused)
  const composerTips = useInlineCompletionTip(scopeTips, hasSentBefore && idleDraft)
  // The client answers the vocabulary the server's tip gates are written in, measured against
  // the SELECTED model's window.
  const tipSignals = useTipSignals({
    sessionId: activeSessionId,
    usage,
    contextDiagnostics,
    contextWindow,
  })
  const fullTipContext = useMemo<TipContext>(
    () => ({
      userText: tipContext?.userText ?? '',
      activeToolName: tipContext?.activeToolName ?? null,
      signals: tipSignals,
    }),
    [tipContext, tipSignals],
  )
  return useStreamTip(active, fullTipContext, composerTips, running)
}
