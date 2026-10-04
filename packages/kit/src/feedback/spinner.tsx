import type { SVGProps } from 'react'

import { cn } from '@localixai/plugin-sdk/ui/classes'
import { ActivityOrb } from './activity-orb'

export interface SpinnerProps extends Omit<
  SVGProps<SVGSVGElement>,
  'size' | 'role' | 'aria-label' | 'aria-hidden'
> {
  size?: 'xs' | 'sm' | 'md' | 'lg'
  /** Give a standalone spinner a status label. Inline spinners are decorative by default. */
  label?: string
}

export function Spinner({ className, size = 'sm', label, ...props }: SpinnerProps) {
  const sizeClasses = {
    xs: 'size-2.5',
    sm: 'size-3.5',
    md: 'size-5',
    lg: 'size-8',
  }

  return (
    <ActivityOrb
      state="working"
      className={cn('text-current', sizeClasses[size], className)}
      {...props}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
