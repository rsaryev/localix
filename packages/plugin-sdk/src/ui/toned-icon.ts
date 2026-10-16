import { createElement } from 'react'
import type { IconComponent } from './contrib'
import type { StatusTone } from './status-items'

/**
 * An icon already painted in a status tone, for a described menu row.
 *
 * The defect it closes: a `MenuEntry`'s `icon` is a component the host renders with no class of
 * the caller's, so a tone had nowhere to go. A permission mode, a priority or a severity listed in
 * a menu drew in the row's neutral ink — Autonomous as quiet as Default, the one thing the tone is
 * for — and each surface that noticed wrote its own wrapper, with its own spelling of the tone.
 *
 * The result is CACHED per (icon, tone): a row's icon must be the same component on every render,
 * or React remounts it on each pick. Calling this inline while building entries is therefore safe.
 *
 * The classes are the `status-*` token family the kit's tone maps use (`neutral` is the soft ink a
 * menu's own marks are drawn in), spelled literally so a stylesheet scan finds them.
 */
const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'text-text-soft',
  info: 'text-status-info',
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
}

const CACHE = new WeakMap<IconComponent, Map<StatusTone, IconComponent>>()

export function tonedIcon(Icon: IconComponent, tone: StatusTone): IconComponent {
  let byTone = CACHE.get(Icon)
  if (!byTone) {
    byTone = new Map()
    CACHE.set(Icon, byTone)
  }
  const cached = byTone.get(tone)
  if (cached) return cached

  const toneClass = TONE_CLASS[tone]
  // The rest is spread so what the host passes at runtime (`aria-hidden`) reaches the glyph.
  const Toned = ({ className, ...rest }: { className?: string }) =>
    createElement(Icon, {
      ...rest,
      className: className ? `${toneClass} ${className}` : toneClass,
    })
  Toned.displayName = `Toned(${Icon.displayName ?? Icon.name ?? 'Icon'}, ${tone})`
  byTone.set(tone, Toned)
  return Toned
}
