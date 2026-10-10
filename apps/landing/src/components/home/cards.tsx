import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The one hover/focus arrow the homepage uses. Every card and inline link that
 * leads into the docs opts in by carrying `group/cue`, so the cue reads as a
 * single affordance instead of three hand-tuned variants that drifted apart.
 *
 * The group name is a literal on purpose: Tailwind generates
 * `group-hover/cue:` from source text, so a name built at runtime produces no
 * CSS at all.
 */
export function ArrowCue({ className, reveal = true }: { className?: string; reveal?: boolean }) {
  return (
    <ArrowRight
      aria-hidden
      className={cn(
        'arrow-cue size-3.5 shrink-0 transition-[transform,opacity] duration-[var(--dur-fast)] ease-[var(--ease-soft)]',
        reveal &&
          'text-text-faint opacity-60 group-hover/cue:opacity-100 group-focus-visible/cue:opacity-100',
        className,
      )}
    />
  )
}
