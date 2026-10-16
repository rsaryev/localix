import type { ReactNode, Ref } from 'react'

/** Shared pane geometry for application settings and an agent's configuration. */
export function SettingsWorkspace({
  navigation,
  contentRef,
  children,
}: {
  navigation?: ReactNode
  contentRef?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  return (
    <div className="@container/settings flex h-full w-full min-w-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col @4xl/settings:flex-row">
        {navigation}
        <div ref={contentRef} data-ui-scroll-container className="min-w-0 flex-1 overflow-y-auto">
          <div className="@container w-full px-4 py-6 @2xl/settings:px-6">{children}</div>
        </div>
      </div>
    </div>
  )
}
