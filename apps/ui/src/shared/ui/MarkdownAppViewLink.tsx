import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { subscribeUiLocations, uiLocationRevision } from '@/shared/contrib/uiLocations'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { navigateUi, resolveUiNavigation } from '@/shared/lib/uiNavigation'

/**
 * A `localix://` view an agent linked in its message, opened when the person clicks it — in the
 * chat the message belongs to. A view whose owner has not registered (a plugin not loaded) stays
 * text instead of a link that does nothing.
 */
export function MarkdownAppViewLink({ href, children }: { href: string; children: ReactNode }) {
  useSyncExternalStore(subscribeUiLocations, uiLocationRevision, uiLocationRevision)
  const navigation = useUiNavigation({ sessionId: useWorkItemSessionId() })
  if (!resolveUiNavigation(href)) return <span>{children}</span>
  return (
    <a
      href={href}
      className="cursor-pointer"
      onClick={(event) => {
        event.preventDefault()
        navigateUi(href, navigation)
      }}
    >
      {children}
    </a>
  )
}
