import './index.css'
import './inlineFonts'
import { tauriInvoke } from '@/shared/lib/tauri'
import { isCompanionWindow } from '@/shared/lib/companionWindow'

// Choose the entry before importing the workspace shell, so the island never loads it.
if (isCompanionWindow()) {
  // The island has no devtools in release builds; route boot failures to the desktop log.
  const report = (message: string) =>
    void tauriInvoke()?.('frontend_log', { scope: 'companion.boot', message })
  window.addEventListener('error', (event) => report(event.message))
  window.addEventListener('unhandledrejection', (event) => report(String(event.reason)))
  void import('./companionEntry').catch((error) => report(String(error)))
} else void import('./workspaceEntry')
