import { useEffect, type ComponentProps } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useHorizontalWheelScroll } from '../lib/use-horizontal-wheel-scroll'

type WorkbenchBreadcrumbProps = Omit<ComponentProps<'nav'>, 'aria-label'> & {
  /** Names the represented hierarchy for assistive technology. */
  'aria-label': string
  density?: 'default' | 'compact'
  bordered?: boolean
  /** Keeps inert gaps draggable when the trail is hosted in a Tauri titlebar. */
  dragRegion?: boolean
  /** Keep every level available in a horizontal scrollport. */
  scrollable?: boolean
  /** Scroll to the newest level when this navigation identity changes. */
  scrollToEndKey?: string
}

/**
 * Semantic, single-line workbench hierarchy. Callers own their domain-specific
 * segments but always contribute `<li>` children to the ordered path.
 */
export function WorkbenchBreadcrumb({
  className,
  density = 'default',
  bordered = false,
  dragRegion = false,
  scrollable = false,
  scrollToEndKey,
  children,
  ...props
}: WorkbenchBreadcrumbProps) {
  const scrollRef = useHorizontalWheelScroll<HTMLOListElement>(scrollable)
  useEffect(() => {
    const list = scrollRef.current
    if (!scrollable || !list) return
    const revealEnd = () => {
      list.scrollLeft = list.scrollWidth
    }
    revealEnd()
    const observer = new ResizeObserver(revealEnd)
    observer.observe(list)
    return () => observer.disconnect()
  }, [scrollable, scrollToEndKey, scrollRef])
  return (
    <nav
      data-slot="workbench-breadcrumb"
      data-tauri-drag-region={dragRegion ? true : undefined}
      className={cn(
        'min-w-0 overflow-hidden',
        density === 'default'
          ? 'h-full text-xs font-medium text-text-soft'
          : 'h-[var(--chrome-control-md)] shrink-0 text-2xs text-text-faint',
        bordered && 'border-b border-border-soft',
        className,
      )}
      {...props}
    >
      <ol
        ref={scrollRef}
        data-slot="workbench-breadcrumb-list"
        data-tauri-drag-region={dragRegion ? true : undefined}
        className={cn(
          'm-0 flex h-full min-w-0 list-none items-center p-0',
          scrollable
            ? 'overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-thin'
            : 'overflow-hidden',
          density === 'default' ? 'gap-1.5' : 'gap-1 px-(--workbench-gutter)',
        )}
      >
        {children}
      </ol>
    </nav>
  )
}

export type { WorkbenchBreadcrumbProps }
