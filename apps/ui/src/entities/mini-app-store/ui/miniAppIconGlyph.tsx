import type { ComponentType } from 'react'
import { storeMediaSrc } from '../model/storeFilters'

type Glyph = ComponentType<{ className?: string }>

const glyphs = new Map<string, Glyph>()

/**
 * An installed mini app's own icon as a rail glyph: a component that takes the class the rail
 * sizes its glyphs with, the same one per address so the rail does not remount it. The rail
 * labels the button; the picture is decorative.
 */
export function miniAppIconGlyph(icon: string): Glyph {
  const known = glyphs.get(icon)
  if (known) return known
  const src = storeMediaSrc(icon)
  function MiniAppIconGlyph({ className }: { className?: string }) {
    return (
      <img src={src} alt="" draggable={false} className={`object-contain ${className ?? ''}`} />
    )
  }
  glyphs.set(icon, MiniAppIconGlyph)
  return MiniAppIconGlyph
}
