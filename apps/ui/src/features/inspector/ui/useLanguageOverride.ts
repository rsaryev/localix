import { useState } from 'react'
import { languageFromPath } from '@/shared/ui/diff'

/**
 * "Change Language Mode" (⌘K M): a per-tab syntax override picked from
 * the status bar, or `null` to follow the path-detected language. Reset when the
 * tab shows a different file (a new grid WorkItem remounts, but a re-target reuses it).
 */
export function useLanguageOverride(path: string) {
  const autoLanguage = languageFromPath(path)
  const [languageOverride, setLanguageOverride] = useState<string | null>(null)
  // Reset the override when the tab re-targets a different file (adjust-state-
  // during-render pattern — avoids an effect + a stale-highlight flash).
  const [langOverridePath, setLangOverridePath] = useState(path)
  if (path !== langOverridePath) {
    setLangOverridePath(path)
    setLanguageOverride(null)
  }
  return { autoLanguage, language: languageOverride ?? autoLanguage, setLanguageOverride }
}
