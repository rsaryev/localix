'use client'

import * as React from 'react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'

import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { OVERLAY_SLIDE, TOOLTIP_ENTER_EXIT } from './overlay-motion'
import { FLOATING_SURFACE } from './popover-surface'

const TooltipScopeContext = React.createContext(false)

/**
 * The app-standard styled tooltip (replaces the slow, unstyled native `title=`
 * on migrated controls — when adopting it, REMOVE the native `title` so the two
 * never double up; keep `aria-label`). Same radix-ui + token conventions as
 * popover.tsx. `Tooltip` is SELF-PROVIDING: each instance carries its own
 * Provider with a short delay, so no app-root wiring is needed.
 * Known acceptable gap: Radix tooltips don't show on disabled triggers.
 */
function TooltipProvider({
  delayDuration = 500,
  skipDelayDuration = 300,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipScopeContext.Provider value>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        skipDelayDuration={skipDelayDuration}
        {...props}
      >
        {children}
      </TooltipPrimitive.Provider>
    </TooltipScopeContext.Provider>
  )
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const hasSharedProvider = React.useContext(TooltipScopeContext)
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />

  // The app root provides one shared delay group so moving across adjacent IDE
  // actions reveals their labels without restarting the delay. Keep an isolated
  // fallback for plugin previews, tests and independently mounted surfaces.
  return hasSharedProvider ? root : <TooltipProvider>{root}</TooltipProvider>
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  // `data-slot` belongs to the concrete control when `asChild` is used. A
  // distinct marker preserves Button/IconButton identity through nested Radix
  // trigger composition instead of overwriting it with "tooltip-trigger".
  return <TooltipPrimitive.Trigger data-tooltip-trigger="true" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 6,
  forceMount,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal forceMount={forceMount}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        forceMount={forceMount}
        className={cn(
          // The floating material at control radius — the same glass as every popover, sized
          // down to a label. It used to transcribe the material and dropped the rim ring on the
          // way, so a tooltip over a dark pane lost the edge every other floating surface keeps.
          // Its motion has its own gate: Tooltip's open data-state is "delayed-open" /
          // "instant-open", never plain "open" (see overlay-motion.ts).
          FLOATING_SURFACE,
          TOOLTIP_ENTER_EXIT,
          OVERLAY_SLIDE.near,
          'z-(--z-tooltip) flex select-none items-center gap-1.5 px-2 py-1 text-xs',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}

type MetadataTooltipProps = {
  /** Passive status or metadata node. This primitive never adds button semantics or a tab stop. */
  children: React.ReactElement
  label: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}

/**
 * Managed hover for passive IDE metadata (status dots, diff counts, file state).
 * Actions use ActionTooltip instead: keeping the two contracts separate prevents
 * explanatory metadata from masquerading as an operable control.
 *
 * `asChild` preserves the caller's exact DOM geometry. The trigger remains
 * non-focusable unless the caller already made it focusable; screen-reader text
 * therefore belongs on the child (`aria-label`, adjacent text, or visible copy).
 * This lives beside the tooltip foundation so a tiny semantic adapter never
 * becomes another production preload request.
 */
function MetadataTooltip({ children, label, side = 'top', align }: MetadataTooltipProps) {
  if (label === null || label === undefined || label === '') return children

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        className="max-w-[min(32rem,calc(100vw-2rem))] whitespace-normal break-words"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export { MetadataTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
export type { MetadataTooltipProps }
