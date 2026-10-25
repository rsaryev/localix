import { createContext, useContext, useRef, type ReactNode, type Ref } from 'react'
import { useElementWidth } from '@localixai/kit/lib'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** The pane width from which the sections are a column beside the page (Tailwind's 4xl). */
const WIDE_PX = 896

const WideContext = createContext(true)

/** Whether the settings pane is wide enough for its sections to sit beside the page. */
export const useSettingsWide = () => useContext(WideContext)

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
  const root = useRef<HTMLDivElement>(null)
  const width = useElementWidth(root)
  const wide = width === null || width >= WIDE_PX
  return (
    <WideContext.Provider value={wide}>
      <div
        ref={root}
        className="@container/settings flex h-full w-full min-w-0 flex-col overflow-hidden"
      >
        <div className={cn('flex min-h-0 flex-1', wide ? 'flex-row' : 'flex-col')}>
          {navigation}
          <div ref={contentRef} data-ui-scroll-container className="min-w-0 flex-1 overflow-y-auto">
            <div className="@container w-full px-4 py-6 @2xl/settings:px-6">{children}</div>
          </div>
        </div>
      </div>
    </WideContext.Provider>
  )
}
