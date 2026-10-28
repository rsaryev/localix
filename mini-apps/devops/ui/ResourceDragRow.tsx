import { useRef, type HTMLAttributes, type ReactNode } from 'react'

import { isRowSelectClick, type PointerPoint } from '@localixai/mini-app-sdk/ui/utilities'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { setDevOpsResourceDrag } from './resourceDrag'

/**
 * A resource row whose whole stable surface can be dragged into the main input.
 *
 * Child buttons retain their ordinary click behaviour; a real native drag
 * suppresses their click automatically, so opening details and resource actions
 * no longer compete for the same tap.
 */
export function ResourceDragRow({
  uri,
  label,
  onOpen,
  children,
  className,
  ...props
}: {
  uri?: string
  label: string
  onOpen?: () => void
  children: ReactNode
  className?: string
} & Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'className' | 'onClick' | 'onDragStart' | 'onPointerDown'
>) {
  const linkable = Boolean(uri)
  const pointerDownRef = useRef<PointerPoint | null>(null)
  const pointerStartedOnControlRef = useRef(false)
  const draggedRef = useRef(false)
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the click on the row's spare surface and the HTML5 drag are mouse shortcuts; the name button and the action buttons inside are the keyboard path
    <div
      {...props}
      role={props.role ?? 'listitem'}
      draggable={linkable}
      data-resource-uri={uri}
      className={cn(
        'select-none',
        (linkable || onOpen) && 'cursor-pointer active:cursor-grabbing',
        className,
      )}
      onPointerDown={(event) => {
        pointerDownRef.current = { x: event.clientX, y: event.clientY }
        const target = event.target as HTMLElement
        const control = target.closest('button, input, textarea, select, a, [role="menuitem"]')
        // The visible name is a real button for keyboard/click semantics, but it
        // is also the row's largest, most discoverable drag surface. Only
        // independent action controls (Stop/Delete/…) should veto a drag.
        pointerStartedOnControlRef.current = Boolean(
          control && !target.closest('[data-resource-drag-surface]'),
        )
        draggedRef.current = false
      }}
      onDragStart={(event) => {
        if (!uri) return
        // Native `draggable` on a parent can otherwise steal a tiny pointer
        // movement from row actions before their click fires. Buttons keep
        // ordinary click semantics; the remaining row surface stays the drag target.
        if (pointerStartedOnControlRef.current) {
          event.preventDefault()
          return
        }
        draggedRef.current = true
        setDevOpsResourceDrag(event.dataTransfer, { uri, label })
      }}
      onDragEnd={() => {
        pointerDownRef.current = null
        pointerStartedOnControlRef.current = false
        // Keep the drag marker through the browser's same-frame synthetic click.
        // A normal click begins with a new pointerdown and clears it immediately.
        requestAnimationFrame(() => {
          draggedRef.current = false
        })
      }}
      onClick={(event) => {
        // Buttons and links inside the row own their actions. Clicking whitespace
        // or metadata opens the same details as the primary name control.
        if ((event.target as HTMLElement).closest('button, input, a, [role="menuitem"]')) {
          pointerDownRef.current = null
          pointerStartedOnControlRef.current = false
          return
        }
        const shouldOpen = isRowSelectClick(
          pointerDownRef.current,
          { x: event.clientX, y: event.clientY },
          draggedRef.current,
        )
        pointerDownRef.current = null
        pointerStartedOnControlRef.current = false
        if (shouldOpen) onOpen?.()
      }}
    >
      {children}
    </div>
  )
}
