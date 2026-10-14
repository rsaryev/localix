import { useEffect, type RefObject } from 'react'

import { parseSettingsAnchorUri } from '@/shared/lib/settingsAnchors'
import { registerUiTarget, registerUiTargetMaterializer } from '@/shared/lib/uiTargetRegistry'

/** How long the bridge waits for a section to appear before giving the navigation up. */
const MATERIALIZE_TIMEOUT_MS = 5_000

/**
 * Bridge the static settings index into the application-wide URI target registry.
 *
 * A settings section already carries a stable `data-settings-anchor`, but it only exists in
 * the DOM once its tab is rendered — and a search hit navigates to a tab and its section in
 * one motion. So a target cannot simply be registered on mount: this observes the panel's
 * content until the anchor appears, then registers it, which is what lets global search use
 * the same navigation path for a settings section as for every other result type.
 */
export function useSettingsAnchorMaterializer(contentRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const registrations = new Map<string, () => void>()
    const observers = new Set<MutationObserver>()
    const unregisterMaterializer = registerUiTargetMaterializer({
      id: 'settings-index-sections',
      supports: (uri) => Boolean(parseSettingsAnchorUri(uri)?.anchor),
      materialize: (uri) =>
        new Promise<void>((resolve) => {
          const anchor = parseSettingsAnchorUri(uri)?.anchor
          const container = contentRef.current
          if (!anchor || !container) {
            resolve()
            return
          }
          const register = () => {
            const element = Array.from(
              container.querySelectorAll<HTMLElement>('[data-settings-anchor]'),
            ).find((candidate) => candidate.dataset.settingsAnchor === anchor)
            if (!element) return false
            if (element.hasAttribute('data-settings-reveal')) {
              element
                .querySelector<HTMLButtonElement>(
                  '[data-slot="collapsible-section-trigger"][aria-expanded="false"]',
                )
                ?.click()
            }
            registrations.get(uri)?.()
            registrations.set(uri, registerUiTarget(uri, element))
            resolve()
            return true
          }
          if (register()) return
          const observer = new MutationObserver(() => {
            if (!register()) return
            observer.disconnect()
            observers.delete(observer)
          })
          observers.add(observer)
          observer.observe(container, { childList: true, subtree: true })
          window.setTimeout(() => {
            observer.disconnect()
            observers.delete(observer)
            resolve()
          }, MATERIALIZE_TIMEOUT_MS)
        }),
    })
    return () => {
      unregisterMaterializer()
      observers.forEach((observer) => observer.disconnect())
      registrations.forEach((unregister) => unregister())
    }
  }, [contentRef])
}
