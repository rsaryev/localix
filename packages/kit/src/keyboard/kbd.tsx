import type { ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@localixai/plugin-sdk/ui/classes'

/**
 * Keycap chip for keyboard-shortcut hints. One source of truth for the
 * hand-rolled `<kbd>` chips that drifted across menus, palettes and HITL
 * footers. The DEFAULT is the bg-less faint recipe (ChordHint / HITL confirm
 * footer — the documented baseline); `variant="filled"` adds the raised
 * background used by the command-palette footers and settings keycaps.
 * Surfaces that want different sizing override via `className` (cn/twMerge,
 * so e.g. `text-2xs text-text-soft` wins). The glyph size is the type scale's
 * `3xs` — keycaps were three one-off literals (0.55/0.6/0.65rem) before it existed.
 */
const kbdVariants = cva(
  'inline-flex min-h-4 min-w-4 shrink-0 items-center justify-center rounded-sm border border-control-border/70 px-1 align-middle font-mono text-3xs leading-none text-text-faint',
  {
    variants: {
      variant: {
        default: '',
        // Foreground veil, not `bg-surface-raised`: the raised token mixes from a darker
        // ground than the pane, so a filled keycap read as a black chip in the palette
        // footers. The veil takes the pane's own colour and only adds density.
        filled: 'bg-foreground/[0.06]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Kbd({
  children,
  className,
  variant,
}: { children: ReactNode; className?: string } & VariantProps<typeof kbdVariants>) {
  return <kbd className={cn(kbdVariants({ variant }), className)}>{children}</kbd>
}
