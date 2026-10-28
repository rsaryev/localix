import type { ReactNode, Ref } from 'react'

/** Shared pane geometry for application settings: the sections above, the page below. */
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
      {navigation}
      <div
        ref={contentRef}
        data-ui-scroll-container
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        <div className="@container w-full px-4 py-6 @2xl/settings:px-6">{children}</div>
      </div>
    </div>
  )
}
