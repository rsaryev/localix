import type { KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { IconButton } from '../../controls/icon-button'
import { ChordHint } from '../../keyboard/chord-hint'
import { Chip } from '../../feedback/chip'
import { DROP_TARGET_INDICATOR_BEFORE_VERTICAL } from '../../lists/drop-target'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../overlays/context-menu'
import type { TabReorder } from './reorder'
import type { TAB_STRIP_VARIANTS } from './tab-strip-classes'
import type { StripTabItem } from './tab-types'

interface TabStripTabProps<T extends string> {
  item: StripTabItem<T>
  index: number
  active: boolean
  /** First render of a just-created tab: plays the entrance animation. */
  isNew: boolean
  look: (typeof TAB_STRIP_VARIANTS)[keyof typeof TAB_STRIP_VARIANTS]
  drag: TabReorder<T>
  registerTab: (id: T) => (node: HTMLButtonElement | null) => void
  navigate: (index: number, event: KeyboardEvent) => void
  onChange: (id: T) => void
  tabClassName?: string
  activeTabClassName?: string
  inactiveTabClassName?: string
}

/** One editor-style tab of a `TabStrip`: label, badge, close/dirty slot and optional menu. */
export function TabStripTab<T extends string>({
  item,
  index,
  active,
  isNew,
  look,
  drag,
  registerTab,
  navigate,
  onChange,
  tabClassName,
  activeTabClassName,
  inactiveTabClassName,
}: TabStripTabProps<T>) {
  const tabClasses = cn(
    'group relative flex shrink-0 items-center outline-none transition-[background-color,color,opacity] duration-(--dur-fast) ease-(--ease-out) motion-reduce:transition-none',
    look.tab,
    active ? look.active : look.inactive,
    active ? activeTabClassName : inactiveTabClassName,
    item.italic && 'italic',
    item.faded && 'opacity-50',
    item.disabled && 'cursor-not-allowed opacity-50',
    // Subtle scale-fade entrance for a just-created tab.
    isNew && 'animate-in fade-in zoom-in-90 duration-(--dur-base)',
    // Reorder feedback: dim the tab being dragged; show an insertion caret
    // on the current drop target (the dragged tab lands before it).
    drag.draggingId === item.id && 'opacity-40',
    drag.dragOverId === item.id && DROP_TARGET_INDICATOR_BEFORE_VERTICAL,
    tabClassName,
  )
  const button = (
    <div
      className={tabClasses}
      {...drag.tabProps(item.id)}
      onContextMenu={(event) => item.onContextMenu?.(item.id, event)}
      onAuxClick={(e) => {
        if (e.button === 1 && item.onAuxClose) {
          e.preventDefault()
          item.onAuxClose(item.id)
        }
      }}
    >
      <button
        ref={registerTab(item.id)}
        type="button"
        role="tab"
        id={item.tabId}
        aria-controls={item.panelId}
        aria-selected={active}
        disabled={item.disabled}
        tabIndex={active ? 0 : -1}
        title={item.title}
        onClick={() => !item.disabled && onChange(item.id)}
        onDoubleClick={
          item.onDoubleClick ? () => !item.disabled && item.onDoubleClick?.(item.id) : undefined
        }
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || item.disabled) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onChange(item.id)
            return
          }
          navigate(index, e)
        }}
        data-tabstrip-id={item.id}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left outline-none focus-ring disabled:cursor-not-allowed"
      >
        {/* Attention pip: unseen background activity. Suppressed on the active
        tab (you're looking at it, so it's already "seen"). */}
        {item.attention && !active && (
          <span aria-hidden className="mr-0.5 size-1.5 shrink-0 rounded-full bg-status-info" />
        )}
        {item.icon}
        <span className="truncate">{item.label}</span>
        {item.hint && (
          <span className="shrink-0 truncate text-2xs text-text-faint">{item.hint}</span>
        )}
        {item.badge && (
          <Chip
            size="dense"
            tone={
              item.badgeTone === 'error'
                ? 'error'
                : item.badgeTone === 'warn'
                  ? 'warning'
                  : 'neutral'
            }
            className={cn(
              'shrink-0 py-px',
              (!item.badgeTone || item.badgeTone === 'default') && 'text-text-soft',
            )}
          >
            {item.badge}
          </Chip>
        )}
      </button>
      {item.onClose && (
        <span className="relative ml-px flex items-center">
          {/* Dirty dot: shown in the close slot while unsaved and the tab
            isn't hovered/focused; the X below takes over on hover so the
            tab can still be closed. */}
          {item.dirty && (
            <span
              aria-hidden
              className="lx-tab-dirty-indicator pointer-events-none absolute inset-0 flex items-center justify-center group-hover:opacity-0 group-focus-within:opacity-0"
            >
              <span className="size-2 rounded-full bg-foreground/70" />
            </span>
          )}
          <IconButton
            size="xs"
            aria-label={item.closeLabel ?? 'Close tab'}
            tooltip={item.closeLabel ?? 'Close tab'}
            className={cn(
              'lx-hover-actions opacity-60 hover:opacity-100',
              !active &&
                !look.closeAlwaysVisible &&
                !item.dirty &&
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              item.dirty &&
                'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
              look.closeAlwaysVisible && 'relative z-(--z-raised)',
            )}
            onClick={(e) => {
              e.stopPropagation()
              item.onClose?.(item.id)
            }}
          >
            <X className="size-3" />
          </IconButton>
        </span>
      )}
    </div>
  )
  return item.menu && item.menu.length > 0 ? (
    <div key={item.id}>
      <ContextMenu>
        <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
        <ContextMenuContent>
          {item.menu.map((m, i) => (
            <div key={m.label}>
              {m.separatorBefore && i > 0 && <ContextMenuSeparator />}
              <ContextMenuItem disabled={m.disabled} onSelect={() => m.onSelect(item.id)}>
                {m.label}
                {m.chordId && <ChordHint commandId={m.chordId} />}
              </ContextMenuItem>
            </div>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  ) : (
    <div key={item.id}>{button}</div>
  )
}
