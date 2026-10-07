// Adapted from launch-ui/launch-ui/components/ui/mockup.tsx (MIT).
// Copyright (c) 2024 Mikolaj Dobrucki. License: /licenses/launch-ui-LICENSE.txt.
import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function MockupFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="mockup-frame"
      className={cn(
        'relative flex overflow-hidden rounded-2xl bg-foreground/5 p-2 shadow-[var(--shadow-soft)]',
        className,
      )}
      {...props}
    />
  )
}

export function Mockup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="mockup"
      className={cn(
        'relative flex w-full overflow-hidden rounded-md border border-border-subtle bg-background',
        className,
      )}
      {...props}
    />
  )
}
