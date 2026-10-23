import type { ComponentType } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
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
      <img
        src={src}
        alt=""
        draggable={false}
        // An app icon is a whole tile with its glyph inside, not a line glyph: drawn at the rail's
        // glyph box it is unreadable, so it takes 24px and keeps the box with a negative margin.
        className={cn(className, '-m-1 size-6 max-w-none object-contain')}
      />
    )
  }
  glyphs.set(icon, MiniAppIconGlyph)
  return MiniAppIconGlyph
}
