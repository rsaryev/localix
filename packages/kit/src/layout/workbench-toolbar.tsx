import { forwardRef, type ComponentProps, type ComponentPropsWithoutRef } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { FLOATING_SURFACE } from '../overlays/popover-surface'

const TOOLBAR_DENSITY = {
  /** Pane and workbench action row. */
  default: 'h-[var(--panel-header-height)] px-(--workbench-gutter)',
  /** Secondary editor controls such as preview navigation and chart timeframes. */
  compact: 'h-[var(--chrome-control-lg)] px-2.5',
  /** Embedded captions and code/diff micro-chrome: one 28px control measure. */
  slim: 'h-[var(--chrome-control-md)] px-2',
} as const

const TOOLBAR_WRAP_DENSITY = {
  default: 'h-auto min-h-[var(--panel-header-height)] flex-wrap py-1.5',
  compact: 'h-auto min-h-[var(--chrome-control-lg)] flex-wrap py-1',
  slim: 'h-auto min-h-[var(--chrome-control-md)] flex-wrap py-0.5',
} as const satisfies Record<keyof typeof TOOLBAR_DENSITY, string>

type WorkbenchToolbarDensity = keyof typeof TOOLBAR_DENSITY
type WorkbenchToolbarLayout = 'inline' | 'stacked'
type WorkbenchToolbarTone = 'content' | 'sidebar'

const FLOATING_ACTION_PLACEMENT = {
  'top-start': 'left-2 top-2',
  'top-end': 'right-2 top-2',
  'bottom-start': 'bottom-2 left-2',
  'bottom-end': 'bottom-2 right-2',
} as const

type WorkbenchToolbarProps = Omit<ComponentProps<'div'>, 'aria-label'> & {
  /** Names the control group without claiming ARIA toolbar arrow-key semantics. */
  'aria-label': string
  /** Preserve document structure for headers and embedded figure captions. */
  as?: 'div' | 'header' | 'figcaption'
  density?: WorkbenchToolbarDensity
  /** Structural seam token for content panels or sidebar/rail chrome. */
  tone?: WorkbenchToolbarTone
  /** Stacked is the canonical search + scope/filter arrangement. */
  layout?: WorkbenchToolbarLayout
  /** Allows multi-line inline action sets while retaining the density's minimum measure. */
  wrap?: boolean
}

const TOOLBAR_SECTION_SPACING = {
  /** Adjacent icon actions: a compact action cluster. */
  compact: 'gap-0.5',
  /** Mixed text controls, selects, and buttons. */
  default: 'gap-1.5',
} as const

type WorkbenchToolbarSectionProps = Omit<ComponentPropsWithoutRef<'div'>, 'aria-label'> & {
  /** `end` forms the stable trailing action cluster and absorbs free inline space. */
  align?: 'start' | 'end'
  spacing?: keyof typeof TOOLBAR_SECTION_SPACING
  /** Allows a large action set to remain reachable in narrow panes. */
  wrap?: boolean
  /** When present, exposes this section as a named nested control group. */
  'aria-label'?: string
}

/**
 * Stable inline or stacked chrome for editor and contributed-workbench controls.
 *
 * The default `group` role intentionally preserves native Tab navigation. A true
 * ARIA toolbar needs roving focus and arrow-key ownership; callers may opt into
 * that role only when they also implement that keyboard contract.
 */
export function WorkbenchToolbar({
  className,
  as: Comp = 'div',
  density = 'default',
  tone = 'content',
  layout = 'inline',
  wrap = false,
  role = 'group',
  'aria-label': ariaLabel,
  ...props
}: WorkbenchToolbarProps) {
  return (
    <Comp
      data-slot="workbench-toolbar"
      role={role}
      aria-label={ariaLabel}
      className={cn(
        'flex shrink-0 border-b',
        tone === 'sidebar' ? 'border-sidebar-border' : 'border-border-soft',
        TOOLBAR_DENSITY[density],
        layout === 'inline' ? 'items-center gap-2' : 'h-auto flex-col items-stretch gap-1.5 py-2',
        layout === 'inline' && wrap && TOOLBAR_WRAP_DENSITY[density],
        className,
      )}
      {...props}
    />
  )
}

/**
 * Primary/trailing section inside a WorkbenchToolbar.
 *
 * The toolbar owns the outer pane measure and seam; sections own action
 * clustering and alignment. A label opts into a nested ARIA group while an
 * unlabeled status/summary section stays semantically transparent.
 */
const WorkbenchToolbarSection = forwardRef<HTMLDivElement, WorkbenchToolbarSectionProps>(
  (
    {
      className,
      align = 'start',
      spacing = 'default',
      wrap = false,
      role,
      'aria-label': ariaLabel,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      data-slot="workbench-toolbar-section"
      data-align={align}
      role={role ?? (ariaLabel ? 'group' : undefined)}
      aria-label={ariaLabel}
      className={cn(
        'flex max-w-full min-w-0 items-center',
        TOOLBAR_SECTION_SPACING[spacing],
        align === 'end' && 'ml-auto shrink-0',
        wrap && 'flex-wrap',
        wrap && align === 'end' && 'justify-end',
        className,
      )}
      {...props}
    />
  ),
)
WorkbenchToolbarSection.displayName = 'WorkbenchToolbarSection'

/**
 * `FLOATING_SURFACE` (defined in `popover-surface.ts`, re-exported here for the kit) is the one
 * blessed material for chips/toolbars floating over pane content. `FloatingActionGroup` carries it
 * by default; standalone floating surfaces (find widgets, hover action bars, selection bars)
 * compose it so every floating chip frosts identically.
 *
 * `--popover`, not `--surface-raised`: raised is the SUNKEN code/composer inset, deliberately
 * darker than the shell, and popover-surface.ts has documented since it was written that a panel
 * built from it "reads as a flat black cutout instead of a panel floating above everything else".
 * This was the one floating recipe that ignored the note, which is what made the editor's
 * Preview/Split/Outline row read as a black tray — and the pills inside it painted a SECOND coat
 * of the same token, so 0.85 over 0.90 landed at ~0.985 with two hairlines and two nested blurs.
 * The group is now the single painter and the pills are transparent (see action-pill.tsx).
 *
 * `lx-floating-surface` is the marker index.css hangs cross-cutting repairs off — the mac-glass
 * frost, the increased-contrast outline, the forced-colors border. Omitting it meant this row was
 * the only floating surface in the app that got none of the three, so `backdrop-blur` had to be
 * hand-written here and the accessibility branches simply never applied.
 */

type FloatingActionGroupProps = Omit<ComponentPropsWithoutRef<'div'>, 'aria-label' | 'role'> & {
  /** A visible-independent name for the complete action set. */
  'aria-label': string
  placement?: keyof typeof FLOATING_ACTION_PLACEMENT
  /** Keep a large contributed action set inside a narrow pane. */
  wrap?: boolean
}

/**
 * Stable positioning and semantics for controls floating over an editor/viewer.
 *
 * This is deliberately an ARIA `group`, not a `toolbar`: native Tab order stays
 * intact. A toolbar role would also require roving focus and owned arrow-key
 * navigation. `--z-controls` keeps actions above pane content without escaping
 * into the popover/modal layers.
 */
const FloatingActionGroup = forwardRef<HTMLDivElement, FloatingActionGroupProps>(
  ({ className, placement = 'top-end', wrap = false, 'aria-label': ariaLabel, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="floating-action-group"
      data-placement={placement}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'pointer-events-auto absolute z-(--z-controls) flex max-w-[calc(100%-1rem)] items-center gap-1 p-0.5',
        FLOATING_SURFACE,
        FLOATING_ACTION_PLACEMENT[placement],
        wrap && 'flex-wrap',
        wrap && (placement.endsWith('end') ? 'justify-end' : 'justify-start'),
        className,
      )}
      {...props}
    />
  ),
)
FloatingActionGroup.displayName = 'FloatingActionGroup'

/**
 * A hairline between clusters inside a floating group.
 *
 * Now that the pills inside a group carry no fill of their own, the only thing telling "how am I
 * viewing this" apart from "what do I do with it" is this rule — a gap alone reads as one
 * undifferentiated row. Hand-written twice already (a board's selection bar, the diff hunk bar),
 * which is exactly how the black-chip drift started, so it lives here.
 *
 * `aria-hidden` and no `role="separator"`: the group is an ARIA `group`, not a `menu` or a
 * `toolbar`, so a semantic separator would announce structure the group does not claim.
 */
function FloatingActionDivider({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      aria-hidden
      data-slot="floating-action-divider"
      className={cn('mx-0.5 h-4 w-px shrink-0 bg-border', className)}
      {...props}
    />
  )
}

export type {
  FloatingActionGroupProps,
  WorkbenchToolbarDensity,
  WorkbenchToolbarLayout,
  WorkbenchToolbarProps,
  WorkbenchToolbarSectionProps,
  WorkbenchToolbarTone,
}
export { FLOATING_SURFACE, FloatingActionDivider, FloatingActionGroup, WorkbenchToolbarSection }
