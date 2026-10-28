import { forwardRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Copy, Highlighter, PenLine, X } from 'lucide-react'

import type { IconComponent } from '@localixai/mini-app-sdk/ui'
import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { READER_HIGHLIGHT_COLORS, type ReaderHighlightColor } from './model'

export const READER_HIGHLIGHT_COLOR_LABELS: Record<ReaderHighlightColor, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
}

export function ReaderHighlightSwatch({ color }: { color: ReaderHighlightColor }) {
  return (
    <span
      className="reader-highlight-swatch size-3.5 shrink-0 rounded-full border border-foreground/15"
      data-color={color}
      aria-hidden="true"
    />
  )
}

/**
 * Each colour's swatch as a menu row's icon.
 *
 * Built once per colour, not per render: a row's icon must be the same component on every render,
 * or React remounts the swatch on each pick. The swatch draws its own size, so the menu's icon
 * sizing (which targets an `svg`) leaves it alone.
 */
const SWATCH_ICONS = Object.fromEntries(
  READER_HIGHLIGHT_COLORS.map((color) => {
    const Swatch: IconComponent = () => <ReaderHighlightSwatch color={color} />
    Swatch.displayName = `ReaderHighlightSwatch(${color})`
    return [color, Swatch]
  }),
) as Record<ReaderHighlightColor, IconComponent>

interface ReaderSelectionToolbarProps {
  style?: CSSProperties
  placement?: 'above' | 'below'
  visible: boolean
  highlightColor: ReaderHighlightColor
  onHighlight: (color: ReaderHighlightColor) => void
  onNote: () => void
  onCopy: () => void
  onClear: () => void
}

export const ReaderSelectionToolbar = forwardRef<HTMLDivElement, ReaderSelectionToolbarProps>(
  (
    { style, placement = 'above', visible, highlightColor, onHighlight, onNote, onCopy, onClear },
    ref,
  ) => {
    const overlaySide = placement === 'above' ? 'top' : 'bottom'
    const onToolbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const buttons = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      )
      if (!buttons.length) return
      const activeIndex = buttons.indexOf(event.target as HTMLButtonElement)
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : event.key === 'ArrowLeft'
              ? (Math.max(0, activeIndex) - 1 + buttons.length) % buttons.length
              : (Math.max(-1, activeIndex) + 1) % buttons.length
      event.preventDefault()
      event.stopPropagation()
      buttons[nextIndex]?.focus({ preventScroll: true })
    }

    return (
      // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the toolbar pattern: the buttons inside are the focus stops and hand their arrow keys up; the container itself is never focused
      <div
        ref={ref}
        role="toolbar"
        aria-label="Selected passage actions"
        aria-orientation="horizontal"
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Escape"
        aria-hidden={!visible || undefined}
        inert={!visible || undefined}
        data-placement={placement}
        data-visible={visible || undefined}
        className="reader-selection-toolbar absolute z-(--z-controls) flex max-w-[calc(100%-1rem)] items-center rounded-lg border border-[var(--reader-rule)] bg-popover p-1 shadow-(--shadow-raised)"
        style={style}
        onKeyDown={onToolbarKeyDown}
      >
        <div className="reader-selection-actions flex min-w-0 items-center gap-0.5 overflow-x-auto">
          <IconButton
            size="sm"
            onClick={() => onHighlight(highlightColor)}
            aria-label="Highlight selection"
            tooltip="Highlight selection"
          >
            <Highlighter />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" aria-label="Choose highlight color" tooltip="Highlight color">
                <ReaderHighlightSwatch color={highlightColor} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side={overlaySide} className="min-w-40">
              <MenuEntries
                entries={[
                  { header: 'Highlight color' },
                  ...READER_HIGHLIGHT_COLORS.map((color) => ({
                    id: color,
                    label: READER_HIGHLIGHT_COLOR_LABELS[color],
                    icon: SWATCH_ICONS[color],
                    selected: color === highlightColor,
                    onSelect: () => onHighlight(color),
                  })),
                ]}
                family="dropdown"
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton
            size="sm"
            onClick={onNote}
            aria-label="Add note to selection"
            tooltip="Add note"
          >
            <PenLine />
          </IconButton>
          <IconButton size="sm" onClick={onCopy} aria-label="Copy selection" tooltip="Copy">
            <Copy />
          </IconButton>
        </div>
        <div className="mx-0.5 h-5 w-px shrink-0 bg-[var(--reader-rule)]" aria-hidden="true" />
        <IconButton
          size="sm"
          className="shrink-0"
          aria-label="Clear selection"
          tooltip="Clear selection"
          onClick={onClear}
        >
          <X />
        </IconButton>
      </div>
    )
  },
)
ReaderSelectionToolbar.displayName = 'ReaderSelectionToolbar'
