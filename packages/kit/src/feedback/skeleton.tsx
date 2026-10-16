import type { ComponentProps } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

/** Decorative loading geometry. The containing region owns its status and busy state. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      aria-hidden="true"
      data-slot="skeleton"
      className={cn('rounded-sm bg-foreground/[0.04] motion-safe:animate-pulse', className)}
    />
  )
}
