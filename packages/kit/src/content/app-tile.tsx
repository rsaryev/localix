import { useState, type CSSProperties } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { avatarHue, avatarInitials } from './avatar-seed'

/** The bundled icons' margin and corner, as fractions of the tile (`icon.svg`: 64 and 196 of 1024). */
const INSET = 64 / 1024
const CORNER = 196 / 896

export interface AppTileProps {
  /** What does not change — a package id. The hue comes from this. */
  identity: string
  /** The name shown beside it. The letters come from this. */
  label: string
  /** The package's own icon, as the host serves it. Absent, or failing to load: the monogram. */
  src?: string
  /** Edge length in px. */
  size: number
  className?: string
}

/**
 * A package's icon at any size: its own picture when it has one, else a monogram in the same
 * near-black rounded tile the bundled mini app icons are drawn in, its letters and a faint glow
 * tinted by a hue that comes from the identity — so a plugin without an icon sits beside a mini
 * app as one family, and the same plugin is the same colour everywhere. Decorative: the name is
 * always written beside it. A picture is only ever an `<img>`, so an SVG from a source is a
 * picture and nothing more.
 */
export function AppTile({ identity, label, src, size, className }: AppTileProps) {
  const [failed, setFailed] = useState<string | null>(null)
  const box: CSSProperties = { width: size, height: size }
  if (src && failed !== src)
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        draggable={false}
        data-slot="app-tile"
        className={cn('shrink-0 object-contain select-none', className)}
        style={box}
        onError={() => setFailed(src)}
      />
    )
  const inner = size * (1 - 2 * INSET)
  return (
    <span
      aria-hidden="true"
      data-slot="app-tile"
      className={cn('inline-flex shrink-0 items-center justify-center select-none', className)}
      style={box}
    >
      <span
        className="lx-app-tile inline-flex items-center justify-center leading-none font-semibold"
        style={
          {
            width: inner,
            height: inner,
            borderRadius: inner * CORNER,
            fontSize: Math.round(inner * 0.36),
            '--avatar-hue': String(avatarHue(identity)),
          } as CSSProperties
        }
      >
        {avatarInitials(label || identity)}
      </span>
    </span>
  )
}
