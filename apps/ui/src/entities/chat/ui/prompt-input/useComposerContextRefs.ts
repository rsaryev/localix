import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

import { findSessionInState } from '../../model/findSession'
import { useChatStore } from '../../model/store'
import { useContextRefs } from '../../model/useContextRefs'
import {
  ambientAutoRefs,
  retainCurrentSelectionDismissals,
  type AmbientTabLink,
} from './ambientTabLinks'

/**
 * The composer's context references: typed @-refs, pinned (dragged-in) refs, and the ambient
 * links of the open editor tabs — one set, budgeted against the selected model's window.
 *
 * Both halves here are gated on VISIBILITY, not focus — see `ambientTabLinks.ts` for why, and
 * for the tests. Warm-hidden composers stay mounted to keep their drafts, and THAT is what must
 * not derive or preflight; gating the two halves on different signals would drift (chips visible
 * with no sizes, or sizes fetched for a hidden panel).
 */
export function useComposerContextRefs(
  prompt: string,
  activeSessionId: string | null,
  activeTabLinks: readonly AmbientTabLink[] | undefined,
  contextWindow: number | undefined,
) {
  // Every ref-kind registry kind (@file/@folder/@diff/@git:N/@session:/@terminal:/@call:).
  // The session is the whole scope once there is one: the server resolves its directory
  // (no client-computed root) and scopes @call lookups to its own transcript.
  const refScope = useChatStore(
    useShallow((s) => {
      const session = findSessionInState(s, activeSessionId)
      return {
        // `null` is the owning Global scope, not a missing value that may fall
        // through to whatever project happens to be active during a warm switch.
        projectId: session ? (session.projectId ?? null) : (s.activeProjectId ?? null),
        sessionId: session?.id ?? null,
      }
    }),
  )
  // The derived refs re-arm per tab; × dismisses that tab for the rest of the app session
  // (in-memory — the composer never remounts).
  const [dismissedAutoLinks, setDismissedAutoLinks] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )
  const visible = useWorkItemVisible()
  const dismissLink = useCallback((key: string) => {
    setDismissedAutoLinks((prev) => new Set(prev).add(key))
  }, [])
  useEffect(() => {
    setDismissedAutoLinks((prev) => retainCurrentSelectionDismissals(prev, activeTabLinks))
  }, [activeTabLinks])
  const autoLinks = useMemo(
    () => ambientAutoRefs(activeTabLinks, dismissedAutoLinks, visible, dismissLink),
    [activeTabLinks, dismissedAutoLinks, visible, dismissLink],
  )
  return useContextRefs(prompt, refScope, contextWindow, autoLinks, visible)
}
