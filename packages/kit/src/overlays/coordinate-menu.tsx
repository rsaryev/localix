'use client'

import * as React from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Popover, PopoverAnchor, PopoverContent } from './popover'
import { MENU_CONTENT, MENU_DANGER_ITEM, MENU_ITEM, MENU_SEPARATOR } from './popover-surface'
import type { MenuItemTone } from './popover-surface'

interface CoordinateMenuContextValue {
  close: () => void
}

const CoordinateMenuContext = React.createContext<CoordinateMenuContextValue | null>(null)

function enabledItems(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter(
    (item) => !item.disabled && item.getAttribute('aria-disabled') !== 'true',
  )
}

function focusRelativeItem(
  container: HTMLElement,
  direction: 'first' | 'last' | 'next' | 'previous',
): void {
  const items = enabledItems(container)
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  const index =
    direction === 'first'
      ? 0
      : direction === 'last'
        ? items.length - 1
        : direction === 'next'
          ? current < 0
            ? 0
            : (current + 1) % items.length
          : current < 0
            ? items.length - 1
            : (current - 1 + items.length) % items.length
  items[index]?.focus({ preventScroll: true })
}

/**
 * A collision-aware action menu for surfaces whose invocation point is not a DOM
 * trigger (canvas, xterm decorations, graphs). Radix owns dismissal, placement,
 * focus containment and layering; this wrapper supplies the vertical-menu keyboard
 * contract and a fixed one-pixel virtual anchor at the pointer coordinates.
 */
function CoordinateMenu({
  x,
  y,
  label,
  onClose,
  className,
  children,
}: {
  x: number
  y: number
  label: string
  onClose: () => void
  className?: string
  children: React.ReactNode
}) {
  const typeahead = React.useRef('')
  const typeaheadReset = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(
    () => () => {
      if (typeaheadReset.current) clearTimeout(typeaheadReset.current)
    },
    [],
  )

  const close = React.useCallback(() => onClose(), [onClose])
  const contextValue = React.useMemo(() => ({ close }), [close])

  return (
    <CoordinateMenuContext.Provider value={contextValue}>
      <Popover open modal onOpenChange={(open) => !open && close()}>
        <PopoverAnchor asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed size-px"
            style={{ left: x, top: y }}
          />
        </PopoverAnchor>
        <PopoverContent
          ref={contentRef}
          role="menu"
          aria-label={label}
          aria-orientation="vertical"
          align="start"
          side="bottom"
          sideOffset={2}
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (contentRef.current) focusRelativeItem(contentRef.current, 'first')
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              focusRelativeItem(
                event.currentTarget,
                event.key === 'ArrowDown' ? 'next' : 'previous',
              )
              return
            }
            if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault()
              focusRelativeItem(event.currentTarget, event.key === 'Home' ? 'first' : 'last')
              return
            }
            if (event.key === 'Tab') {
              event.preventDefault()
              close()
              return
            }
            if (
              event.key.length !== 1 ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              event.key.trim() === ''
            ) {
              return
            }
            typeahead.current += event.key.toLocaleLowerCase()
            if (typeaheadReset.current) clearTimeout(typeaheadReset.current)
            typeaheadReset.current = setTimeout(() => {
              typeahead.current = ''
            }, 500)
            const items = enabledItems(event.currentTarget)
            const match = items.find((item) =>
              item.textContent?.trim().toLocaleLowerCase().startsWith(typeahead.current),
            )
            if (match) {
              event.preventDefault()
              match.focus({ preventScroll: true })
            }
          }}
          className={cn(MENU_CONTENT, 'w-auto gap-0 p-1', className)}
        >
          {children}
        </PopoverContent>
      </Popover>
    </CoordinateMenuContext.Provider>
  )
}

const CoordinateMenuItem = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentPropsWithoutRef<'button'>, 'onSelect'> & {
    tone?: MenuItemTone
    onSelect?: () => void
  }
>(({ className, tone = 'default', onSelect, onClick, children, ...props }, ref) => {
  const menu = React.useContext(CoordinateMenuContext)
  if (!menu) throw new Error('CoordinateMenuItem must be rendered inside CoordinateMenu')
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      className={cn(MENU_ITEM, tone === 'danger' && MENU_DANGER_ITEM, 'w-full', className)}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        onSelect?.()
        menu.close()
      }}
      {...props}
    >
      {children}
    </button>
  )
})
CoordinateMenuItem.displayName = 'CoordinateMenuItem'

function CoordinateMenuSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return <div role="separator" className={cn(MENU_SEPARATOR, className)} {...props} />
}
CoordinateMenuSeparator.displayName = 'CoordinateMenuSeparator'

export { CoordinateMenu, CoordinateMenuItem, CoordinateMenuSeparator }
