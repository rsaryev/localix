import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

interface CollapsibleStripBaseProps {
  /**
   * Leading glyph, rendered in a FIXED 18px slot so every strip's icon column
   * lines up regardless of the glyph (a kind icon, a terminal, a progress ring).
   * Keep it ONE quiet line-icon — the glyph itself carries state (a spinner while
   * running, a ring for progress), so no extra status dots are needed.
   */
  icon: ReactNode
  /** Short count token (`2`, `3/3`) — standardized typography, always right after the glyph. */
  count: ReactNode
  /**
   * Collapsed-only summary — the first / active row, so a collapsed strip reads as
   * "Build the parser · running" not a bare icon. Hidden when expanded.
   */
  summary?: ReactNode
  /**
   * Expanded-only label shown where the summary was — names the list (e.g.
   * "Background jobs") so the header bar doesn't read as empty above the rows.
   */
  title?: ReactNode
  /** The full row list. Always rendered; clipped to 0 height while collapsed. */
  children: ReactNode
  /** Accessible name for the row list controlled by the disclosure. */
  listLabel: string
  /** Controlled expansion state. Omit to use `defaultExpanded`. */
  expanded?: boolean
  defaultExpanded?: boolean
  /** Fires for both controlled and uncontrolled disclosure changes. */
  onExpandedChange?: (expanded: boolean) => void
  /** aria-label for the toggle in each state. */
  label: { expand: string; collapse: string }
  /** Max height of the scroll area when expanded (px). Default 180. */
  maxHeightPx?: number
  /**
   * A CONTROL in the glyph's place, for a strip whose leading icon has somewhere to go.
   *
   * It sits outside the disclosure trigger because it has to: a button inside a button is not
   * a thing a browser or a screen reader can represent. The column is the same 18px the glyph
   * occupies, so a strip that uses it still lines up with the ones that do not — the header's
   * whole job is that the three strips share one set of columns.
   */
  leading?: ReactNode
}

type CollapsibleStripProps = CollapsibleStripBaseProps &
  (
    | { actions?: undefined; actionsLabel?: never }
    | {
        /** Controls beside the disclosure trigger; never nest interactive content in the trigger. */
        actions: ReactNode
        /** Stable accessible name for the action group. */
        actionsLabel: string
      }
  )

/**
 * The shared shell for every composer strip that lists rows under a collapsible,
 * scrollable header — sub-sessions, background jobs, mini app strips. It owns BOTH the
 * behaviour (click-to-toggle bar + animated, scrollable row container) AND the
 * collapsed-bar LAYOUT, so the three strips line up into the same columns:
 *
 *   [ 18px glyph ] [ count ] [ summary · hint ……… ] [ chevron ] [ actions ]
 *
 * Each consumer supplies its own glyph / count / summary / rows; alignment,
 * typography, gaps, and the scroll all live here once.
 */
export function CollapsibleStrip({
  icon,
  count,
  summary,
  title,
  actions,
  actionsLabel,
  children,
  listLabel,
  expanded: controlledExpanded,
  defaultExpanded = false,
  onExpandedChange,
  label,
  maxHeightPx = 180,
  leading,
}: CollapsibleStripProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded)
  const expanded = controlledExpanded ?? uncontrolledExpanded
  const contentId = useId()
  const toggle = () => {
    const next = !expanded
    if (controlledExpanded === undefined) setUncontrolledExpanded(next)
    onExpandedChange?.(next)
  }
  return (
    <div className="border-b border-border-soft">
      <div
        data-slot="collapsible-strip-header"
        className="flex w-full items-center transition-colors duration-(--dur-fast) hover:bg-surface-hover focus-within:bg-surface-hover motion-reduce:transition-none"
      >
        {leading && (
          <span data-slot="collapsible-strip-leading" className="flex shrink-0 items-center pl-3">
            {leading}
          </span>
        )}
        <button
          type="button"
          data-slot="collapsible-strip-trigger"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={expanded ? label.collapse : label.expand}
          // The row measure and gutter come from the chrome scale: this header used
          // to sit at 0.45rem/0.85rem — 7.2px and 13.6px, values on no scale in the
          // app, which put its label 1.6px off every other section header's edge.
          className={cn(
            'flex min-h-[var(--chrome-control-xl)] min-w-0 flex-1 items-center gap-2 py-1.5 text-left outline-none focus-ring',
            leading ? 'pl-2 pr-1' : actions ? 'pl-3 pr-1' : 'px-3',
          )}
        >
          {/* The glyph moves out of the trigger when a control takes its place, so the columns
              hold either way and nothing renders twice. */}
          {!leading && (
            <span className="flex size-4.5 shrink-0 items-center justify-center text-text-faint">
              {icon}
            </span>
          )}
          <span className="shrink-0 text-xs font-medium leading-tight text-text-strong">
            {count}
          </span>
          {expanded ? (
            <span className="min-w-0 flex-1 truncate text-xs leading-tight text-text-faint">
              {title}
            </span>
          ) : summary ? (
            <span className="min-w-0 flex-1 truncate text-xs leading-tight text-text-faint">
              {summary}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 shrink-0 text-text-faint transition-transform duration-(--dur-base) motion-reduce:transition-none"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
        {actions && (
          <div
            data-slot="collapsible-strip-actions"
            role="group"
            aria-label={actionsLabel}
            className="mr-2.5 flex shrink-0 items-center gap-0.5"
          >
            {actions}
          </div>
        )}
      </div>
      <div
        id={contentId}
        data-slot="collapsible-strip-content"
        role="list"
        aria-label={listLabel}
        aria-hidden={!expanded}
        inert={!expanded}
        style={{
          maxHeight: expanded ? `${maxHeightPx}px` : '0px',
          opacity: expanded ? 1 : 0,
          // One expand gesture, one settle: the chevron above and both properties
          // here run --dur-base on --ease-soft (they used to finish at 200/240/180ms).
          // Still inline because no utility can animate a computed max-height — the
          // reduced-motion `transition-duration: 0.01ms !important` rule outranks an
          // inline declaration, so this stays guarded.
          transition:
            'max-height var(--dur-base) var(--ease-soft), opacity var(--dur-base) var(--ease-soft)',
        }}
        className="overflow-y-auto"
      >
        <div role="presentation" className="flex flex-col gap-0.5 px-3 pb-2">
          {children}
        </div>
      </div>
    </div>
  )
}
