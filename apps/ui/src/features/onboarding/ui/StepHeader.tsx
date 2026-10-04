import type { ReactNode } from 'react'

/**
 * The heading block every onboarding step opens with — an optional leading icon,
 * a large title, and a muted one-line subtitle. Extracted so the steps (and the
 * Provider step's sub-views) share ONE type scale + spacing and can't drift. Steps
 * render this inside their centered column.
 */
export function StepHeader({
  icon,
  title,
  subtitle,
}: {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
}) {
  return (
    <div className="space-y-2">
      {icon}
      <h1 className="font-heading text-2xl font-semibold leading-[1.15] tracking-[-0.03em] text-text-strong sm:text-3xl">
        {title}
      </h1>
      {/* No forced centering — the subtitle follows the step's own alignment
          (centered heroes inherit text-center; wide steps stay left-aligned). */}
      {subtitle && <p className="max-w-xl text-sm leading-relaxed text-text-soft">{subtitle}</p>}
    </div>
  )
}
