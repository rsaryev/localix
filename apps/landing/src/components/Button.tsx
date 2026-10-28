import type { ComponentProps } from 'react'
import { Link } from 'react-router'
// Relative, not `@/` — `bun test` runs from the repository root and cannot
// resolve the alias, and this component is now module-loaded by DOM tests.
import { cn } from '../lib/cn'

type Variant = 'primary' | 'outline' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[transform,background-color,border-color,box-shadow,color] duration-[var(--dur-fast)] ease-[var(--ease-soft)] outline-none focus-ring disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90 shadow-[var(--shadow-soft)]',
  outline:
    'border border-control-border text-foreground hover:border-control-border-hover hover:bg-surface-hover',
  ghost: 'text-text-soft hover:text-foreground hover:bg-surface-hover',
}

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-12 px-6 text-base',
}

interface CommonProps {
  variant?: Variant
  size?: Size
  className?: string
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: CommonProps & ComponentProps<'button'>) {
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  )
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  external,
  to,
  children,
  ...props
}: CommonProps & { to: string; external?: boolean } & Omit<ComponentProps<'a'>, 'href'>) {
  const cls = cn(base, variants[variant], sizes[size], className)
  if (external) {
    return (
      <a href={to} className={cls} target="_blank" rel="noreferrer" {...props}>
        {children}
      </a>
    )
  }
  return (
    <Link to={to} className={cls} {...(props as object)}>
      {children}
    </Link>
  )
}
