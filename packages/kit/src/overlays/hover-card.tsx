'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { HoverCard as HoverCardPrimitive } from 'radix-ui'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { OVERLAY_ENTER_EXIT, OVERLAY_SLIDE } from './overlay-motion'
import { POPOVER_SURFACE } from './popover-surface'

/** Rich pointer-accessible preview. Short non-interactive labels still use Tooltip. */
function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(
  (
    { className, align = 'center', sideOffset = 6, collisionPadding = 8, forceMount, ...props },
    ref,
  ) => {
    const bridgeCachedServerPortal =
      process.env.NODE_ENV === 'test' && typeof document !== 'undefined'
    const content = (
      <HoverCardPrimitive.Content
        ref={ref}
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        forceMount={bridgeCachedServerPortal || forceMount}
        className={cn(
          POPOVER_SURFACE,
          OVERLAY_ENTER_EXIT,
          OVERLAY_SLIDE.near,
          'z-(--z-tooltip) flex max-h-[var(--radix-hover-card-content-available-height)] w-72 origin-(--radix-hover-card-content-transform-origin) flex-col items-stretch overflow-y-auto overscroll-contain p-3 text-xs outline-none scrollbar-thin',
          className,
        )}
        {...props}
      />
    )

    if (bridgeCachedServerPortal) return createPortal(content, document.body)
    return <HoverCardPrimitive.Portal>{content}</HoverCardPrimitive.Portal>
  },
)
HoverCardContent.displayName = 'HoverCardContent'

export { HoverCard, HoverCardContent, HoverCardTrigger }
