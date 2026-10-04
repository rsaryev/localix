import { Link } from 'react-router'
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
        'size-3.5 shrink-0 transition-[transform,opacity] duration-[var(--dur-fast)]',
        reveal
          ? 'text-text-faint -translate-x-1 opacity-0 group-hover/cue:translate-x-0 group-hover/cue:opacity-100 group-focus-visible/cue:translate-x-0 group-focus-visible/cue:opacity-100'
          : 'group-hover/cue:translate-x-0.5 group-focus-visible/cue:translate-x-0.5',
        className,
      )}
    />
  )
}

export function GuideLink({ slug, label = 'Read the guide' }: { slug: string; label?: string }) {
  return (
    <Link
      to={`/docs/${slug}`}
      className="group/cue mt-5 inline-flex items-center gap-2 rounded-sm text-sm font-medium text-status-info outline-none hover:text-foreground focus-ring"
    >
      {label}
      <ArrowCue reveal={false} />
    </Link>
  )
}

export interface FeatureLinkCardProps {
  title: string
  body: string
  slug: string
  anchor: string
  kicker?: string
}

/**
 * A capability row: a rule, an optional kicker, the claim, and the sentence
 * that qualifies it. The whole row is the link target, so the hit area matches
 * what the eye reads as one item.
 */
export function FeatureLinkCard({ title, body, slug, anchor, kicker }: FeatureLinkCardProps) {
  return (
    <Link
      to={`/docs/${slug}#${anchor}`}
      className="group/cue block border-t border-border-subtle py-5 outline-none transition-colors hover:border-control-border-hover focus-visible:border-control-border-focus focus-ring"
    >
      {kicker && <p className="eyebrow mb-3">{kicker}</p>}
      <h3 className="flex items-start gap-2 font-heading text-base font-medium text-foreground">
        <span>{title}</span>
        <ArrowCue className="mt-0.5" />
      </h3>
      <p className="mt-2 text-pretty text-sm leading-6 text-text-soft">{body}</p>
    </Link>
  )
}
