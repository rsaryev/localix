import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { subscribeUiLocations, uiLocationRevision } from '@/shared/contrib/uiLocations'
import { inspector } from '@/shared/lib/inspectorBus'
import { STORE_KIND } from '@/shared/lib/openStore'
import { navigateUi, resolveUiNavigation } from '@/shared/lib/uiNavigation'

export function MarkdownAgentLink({ href, children }: { href: string; children: ReactNode }) {
  useSyncExternalStore(subscribeUiLocations, uiLocationRevision, uiLocationRevision)
  const target = resolveUiNavigation(href)
  if (target?.kind !== 'work-item' || target.workKind !== STORE_KIND) return <span>{children}</span>
  return (
    <a
      href={href}
      className="cursor-pointer"
      onClick={(event) => {
        event.preventDefault()
        navigateUi(href, {
          open: (current) => {
            if (current.kind !== 'work-item' || current.workKind !== STORE_KIND) return
            const { kind: _kind, ...item } = current
            inspector.openWorkItem({ ...item, scope: null })
          },
        })
      }}
    >
      {children}
    </a>
  )
}
