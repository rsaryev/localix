import { useEffect } from 'react'
import { isDesktop } from '@localixai/kit/environment'
import { tauriInvoke } from '@/shared/lib/tauri'

const BASE = 'Localix'

interface DocumentTitleInput {
  sessionTitle?: string | null
}

function computeTitle({ sessionTitle }: DocumentTitleInput): string {
  const trimmed = sessionTitle?.trim()
  return trimmed ? `${trimmed} — ${BASE}` : BASE
}

/**
 * Keeps the browser tab title in sync with the active session. Under the Tauri
 * desktop shell it also updates the NATIVE window title (taskbar /
 * window-switcher) — `document.title` alone doesn't drive the OS window title.
 */
export function useDocumentTitle(input: DocumentTitleInput): void {
  const title = computeTitle(input)
  useEffect(() => {
    document.title = title
    if (isDesktop) {
      tauriInvoke()?.('set_title', { title }).catch(() => {
        /* not the Tauri shell / command absent — ignore */
      })
    }
  }, [title])
}
