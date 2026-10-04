import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'
import { SectionLabel } from './section-label'
import { WorkbenchSash } from '../controls/button'

const RESIZE_KEYBOARD_STEP = 16

const sectionResizeMax = (minHeight: number) =>
  typeof window === 'undefined'
    ? minHeight * 8
    : Math.max(minHeight, Math.round(window.innerHeight * 0.8))

interface CollapsibleSectionProps {
  title: string
  /** Open on first render (uncontrolled). Ignored when `open` is provided. */
  defaultOpen?: boolean
  /**
   * Controlled open state. When provided the section is fully controlled — its
   * open/closed value comes from the caller and toggling fires `onOpenChange`
   * instead of mutating internal state. Omit both `open`/`onOpenChange` to keep
   * the default uncontrolled `defaultOpen` behavior.
   */
  open?: boolean
  /** Fires with the next open value on toggle (controlled or uncontrolled). */
  onOpenChange?: (open: boolean) => void
  /** Optional metadata count after the title. */
  count?: number
  /** Right-aligned controls revealed on header hover. Clicks here never toggle the section. */
  actions?: ReactNode
  /** Accessible name for the trailing action group. Derived from `title` by default. */
  actionsLabel?: string
  children: ReactNode
  className?: string
  /** Adds a bottom sash so this open section can own an independently scrolling height. */
  resizable?: boolean
  /** Stable suffix used to persist a user-resized height. */
  resizeStorageKey?: string
  /** Smallest height accepted while dragging. */
  minHeight?: number
}

/**
 * A collapsible, titled panel section — a chevron + uppercase label (+ optional
 * count and hover actions) over content that mounts only while open. A generic
 * primitive for grouping inside narrow panels (Source Control's change groups,
 * commit graph, …); reuse it wherever a panel needs labeled, foldable regions.
 */
export function CollapsibleSection({
  title,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  count,
  actions,
  actionsLabel,
  children,
  className,
  resizable = false,
  resizeStorageKey,
  minHeight = 80,
}: CollapsibleSectionProps) {
  const isControlled = controlledOpen !== undefined
  const contentId = useId()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const sectionRef = useRef<HTMLDivElement>(null)
  const storageKey = resizeStorageKey ? `localix_section_height:${resizeStorageKey}` : null
  const [height, setHeight] = useState<number | null>(() => {
    if (!storageKey) return null
    const stored = Number(loadString(storageKey))
    return Number.isFinite(stored) && stored >= minHeight
      ? Math.min(sectionResizeMax(minHeight), stored)
      : null
  })
  const open = isControlled ? controlledOpen : uncontrolledOpen

  useEffect(() => {
    if (storageKey) saveString(storageKey, height === null ? null : String(height))
  }, [height, storageKey])

  const toggle = () => {
    const next = !open
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const onResizeStart = (event: PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const startY = event.clientY
    const startHeight = sectionRef.current?.getBoundingClientRect().height ?? height ?? minHeight
    const move = (nextEvent: globalThis.PointerEvent) => {
      setHeight(
        Math.max(
          minHeight,
          Math.min(sectionResizeMax(minHeight), startHeight + nextEvent.clientY - startY),
        ),
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onResizeKeyDown = (event: KeyboardEvent) => {
    const max = sectionResizeMax(minHeight)
    const current = height ?? sectionRef.current?.getBoundingClientRect().height ?? minHeight
    const step = event.shiftKey ? RESIZE_KEYBOARD_STEP * 4 : RESIZE_KEYBOARD_STEP
    let next: number | null
    if (event.key === 'ArrowDown') next = current + step
    else if (event.key === 'ArrowUp') next = current - step
    else if (event.key === 'Home') next = minHeight
    else if (event.key === 'End') next = max
    else if (event.key === 'Enter' || event.key === ' ') next = null
    else return
    event.preventDefault()
    setHeight(next === null ? null : Math.max(minHeight, Math.min(max, next)))
  }

  return (
    <div
      ref={sectionRef}
      className={cn(
        'group/section',
        resizable && open && 'flex min-h-0 shrink-0 flex-col',
        className,
      )}
      style={resizable && open && height !== null ? { height } : undefined}
    >
      <div
        data-slot="collapsible-section-header"
        className="group/header flex w-full shrink-0 select-none items-center transition-colors duration-(--dur-fast) hover:bg-surface-hover"
      >
        <button
          type="button"
          data-slot="collapsible-section-trigger"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={toggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 py-1 text-left outline-none focus-ring"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-3.5 shrink-0 text-text-faint transition-transform',
              open && 'rotate-90',
            )}
          />
          <SectionLabel as="span" weight="semibold" className="min-w-0 truncate">
            {title}
          </SectionLabel>
          {count !== undefined && (
            <span className="shrink-0 text-2xs tabular-nums text-text-faint">{count}</span>
          )}
        </button>
        {actions && (
          <div
            data-slot="collapsible-section-actions"
            role="group"
            aria-label={actionsLabel ?? `${title} actions`}
            className="lx-hover-actions mr-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/header:opacity-100 group-focus-within/header:opacity-100"
          >
            {actions}
          </div>
        )}
      </div>
      {/* Mount-only fade+rise (the shared fade-up token) so opening matches the
          app's other disclosures; close still unmounts instantly
          and keeps the perf-motivated conditional mount for heavy children. */}
      {open && (
        <div
          id={contentId}
          data-slot="collapsible-section-content"
          className={cn(
            'animate-fade-up',
            resizable && 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin',
          )}
        >
          {children}
        </div>
      )}
      {open && resizable && (
        <WorkbenchSash
          label={`Resize ${title} section`}
          orientation="horizontal"
          resetLabel="use automatic height"
          valueMin={minHeight}
          valueMax={sectionResizeMax(minHeight)}
          valueNow={height ?? minHeight}
          valueText={height === null ? 'Automatic height' : `${Math.round(height)} pixels`}
          onPointerDown={onResizeStart}
          onKeyDown={onResizeKeyDown}
          onDoubleClick={() => setHeight(null)}
          className="relative w-full"
        />
      )}
    </div>
  )
}
