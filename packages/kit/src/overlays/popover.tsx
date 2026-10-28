'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Popover as PopoverPrimitive } from 'radix-ui'

import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useOverlayFocus } from '@localixai/mini-app-sdk/ui/focus'
import { OVERLAY_ENTER_EXIT, OVERLAY_SLIDE } from './overlay-motion'
import { POPOVER_ACTION, POPOVER_SURFACE, POPOVER_SURFACE_OVER_FOREIGN } from './popover-surface'

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

/** Closes the owning popover while preserving Radix focus-return semantics. */
function PopoverClose({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

type PopoverContentLayout = 'freeform' | 'structured'

type PopoverContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
  /**
   * `freeform` owns its padding and scrolling. `structured` composes the pinned
   * Header / one scrolling Body / pinned Footer regions without a second scroll owner.
   */
  layout?: PopoverContentLayout
  /**
   * What the panel floats over. `app` frosts over the app's own chrome, whose tone the glass is
   * tuned for; `foreign` is the opaque panel for one that always floats over a page the app does
   * not own (see `POPOVER_SURFACE_OVER_FOREIGN`).
   */
  material?: 'app' | 'foreign'
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    {
      className,
      align = 'center',
      sideOffset = 4,
      collisionPadding = 8,
      forceMount,
      layout = 'freeform',
      material = 'app',
      ...props
    },
    ref,
  ) => {
    const claimRef = useOverlayFocus('menu', ref)
    const bridgeCachedServerPortal =
      process.env.NODE_ENV === 'test' && typeof document !== 'undefined'
    const content = (
      <PopoverPrimitive.Content
        ref={claimRef}
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        forceMount={forceMount}
        data-layout={layout}
        className={cn(
          // Material owned by POPOVER_SURFACE — the premium dark inset the model
          // selector / modes popover established, shared with the two menus so a
          // popover never reads as a lighter, out-of-place grey slab.
          material === 'foreign' ? POPOVER_SURFACE_OVER_FOREIGN : POPOVER_SURFACE,
          OVERLAY_ENTER_EXIT,
          OVERLAY_SLIDE.far,
          'z-(--z-popover) flex max-h-[var(--radix-popover-content-available-height)] w-72 origin-(--radix-popover-content-transform-origin) flex-col overscroll-contain text-xs outline-hidden scrollbar-thin',
          layout === 'structured' ? 'gap-0 overflow-hidden p-0' : 'gap-4 overflow-y-auto p-2.5',
          className,
        )}
        {...props}
      />
    )

    // Bun loads every test file in one process. A pure renderer can therefore cache
    // Radix's server-side Portal before a later DOM test registers Happy DOM. The bridge
    // swaps only the portal: a closed popover stays unmounted here exactly as in the app,
    // because a mounted one would claim the focus stack for a popover nobody can see.
    if (bridgeCachedServerPortal) {
      return createPortal(content, document.body)
    }
    return <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal>
  },
)
PopoverContent.displayName = 'PopoverContent'

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

type PopoverHeaderProps = React.ComponentPropsWithoutRef<'header'> &
  (
    | { actions?: undefined; actionsLabel?: never }
    | { actions: React.ReactNode; actionsLabel: string }
  )

/** Pinned context + optional named actions for a structured workbench popover. */
function PopoverHeader({
  className,
  children,
  actions,
  actionsLabel,
  ...props
}: PopoverHeaderProps) {
  return (
    <header
      data-slot="popover-header"
      className={cn(
        'flex shrink-0 flex-wrap items-start gap-3 border-b border-control-border/60 px-3 py-2.5 text-xs',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">{children}</div>
      {actions != null && (
        <div
          role="group"
          aria-label={actionsLabel}
          className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1"
        >
          {actions}
        </div>
      )}
    </header>
  )
}

function PopoverTitle({ className, children, ...props }: React.ComponentPropsWithoutRef<'h2'>) {
  return (
    <h2 data-slot="popover-title" className={cn('text-xs font-medium', className)} {...props}>
      {children}
    </h2>
  )
}

function PopoverDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="popover-description"
      className={cn('text-2xs leading-snug text-text-faint', className)}
      {...props}
    />
  )
}

/** The one scrolling region between a structured popover's pinned edges. */
function PopoverBody({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      data-slot="popover-body"
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-3 scrollbar-thin',
        className,
      )}
      {...props}
    />
  )
}

/** Pinned lower context/actions; callers own its event semantics. */
function PopoverFooter({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      data-slot="popover-footer"
      className={cn('shrink-0 border-t border-control-border/60 p-1.5', className)}
      {...props}
    />
  )
}

type PopoverActionProps = React.ComponentPropsWithoutRef<'button'> & {
  tone?: 'default' | 'danger'
}

/** A native-Tab action row for lifecycle commands that belong inside a popover footer. */
const PopoverAction = React.forwardRef<HTMLButtonElement, PopoverActionProps>(
  ({ className, tone = 'default', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      data-slot="popover-action"
      data-variant="ghost"
      data-size="sm"
      data-tone={tone}
      type={type}
      className={cn(
        POPOVER_ACTION,
        tone === 'danger'
          ? 'text-status-error hover:bg-status-error/10 hover:text-status-error'
          : 'text-text-soft hover:bg-surface-hover hover:text-foreground',
        className,
      )}
      {...props}
    />
  ),
)
PopoverAction.displayName = 'PopoverAction'

export {
  Popover,
  PopoverAction,
  PopoverAnchor,
  PopoverBody,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverFooter,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}

export type { PopoverContentLayout }
