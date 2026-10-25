import { useEffect } from 'react'

import { backendClient } from '@/shared/api/client'
import { findSessionInState } from './findSession'
import { createSessionRecapTrigger, type RecapFocusSignal } from './sessionRecapTrigger'
import { useChatStore } from './store'

/** The browser window's focus: the OS window, or the tab being visible. */
const windowFocus: RecapFocusSignal = {
  isFocused: () => document.hasFocus() && document.visibilityState === 'visible',
  subscribe(listener) {
    window.addEventListener('focus', listener)
    window.addEventListener('blur', listener)
    document.addEventListener('visibilitychange', listener)
    return () => {
      window.removeEventListener('focus', listener)
      window.removeEventListener('blur', listener)
      document.removeEventListener('visibilitychange', listener)
    }
  },
}

/**
 * Mounted once by the chat page: when the person leaves the window for a few minutes after a
 * turn, ask the server for a session recap so it is waiting when they return. The recap shows
 * up as a transcript row; nothing here renders.
 */
export function useSessionRecapTrigger(): void {
  useEffect(() => {
    const trigger = createSessionRecapTrigger({
      clock: {
        now: () => Date.now(),
        setTimeout: (run, ms) => setTimeout(run, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      focus: windowFocus,
      request: (sessionId) => {
        void backendClient.requestSessionRecap(sessionId).catch(() => {})
      },
    })
    let last = ''
    const apply = (state: ReturnType<typeof useChatStore.getState>) => {
      const session = findSessionInState(state, state.activeSessionId)
      const next = {
        sessionId: session?.id ?? null,
        running: session?.isRunning ?? false,
        updatedAtMs: session?.updatedAt ?? null,
      }
      const key = JSON.stringify(next)
      if (key === last) return
      last = key
      trigger.update(next)
    }
    apply(useChatStore.getState())
    const unsubscribe = useChatStore.subscribe(apply)
    return () => {
      unsubscribe()
      trigger.dispose()
    }
  }, [])
}
