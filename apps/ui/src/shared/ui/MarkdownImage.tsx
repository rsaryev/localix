import { useState, type ComponentPropsWithoutRef } from 'react'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { ContributedActions } from './ContributedActions'

type MarkdownImgProps = ComponentPropsWithoutRef<'img'> & { node?: unknown }

/**
 * Markdown image with two affordances: click to open full-size, and a graceful
 * fallback — when the source can't load (e.g. a README's relative `assets/…`
 * path that doesn't resolve in-app) it renders the alt text instead of a broken-
 * image glyph. Honors explicit HTML sizing (logos, badges).
 */
function MarkdownImage({
  src,
  alt,
  width,
  height,
}: {
  src?: string
  alt?: string
  width?: string | number
  height?: string | number
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const safeSrc = typeof src === 'string' ? src : undefined
  const label = typeof alt === 'string' ? alt : ''

  if (!safeSrc) {
    return label ? <span className="text-text-faint">{label}</span> : null
  }
  const open = () => platformCapabilities().external.open(safeSrc)
  return (
    <span className="lx-markdown-image group/image relative inline-block max-w-full">
      {failedSrc === safeSrc ? (
        <span className="text-text-faint">{label || 'Image unavailable'}</span>
      ) : (
        <img
          src={safeSrc}
          alt={label}
          width={width}
          height={height}
          loading="lazy"
          role="button"
          tabIndex={0}
          aria-label={`Open image${label ? `: ${label}` : ''} full size`}
          className="cursor-zoom-in rounded-sm align-middle outline-none transition-[filter] hover:brightness-95 focus-ring"
          onError={() => setFailedSrc(safeSrc)}
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              open()
            }
          }}
        />
      )}
      <span
        className={`${FLOATING_SURFACE} lx-media-actions pointer-events-none absolute right-1 top-1 flex p-0.5 opacity-0 empty:hidden group-hover/image:pointer-events-auto group-hover/image:opacity-100 group-focus-within/image:pointer-events-auto group-focus-within/image:opacity-100`}
      >
        <ContributedActions target={{ kind: 'image', src: safeSrc, alt: label }} />
      </span>
    </span>
  )
}

// Lazy-load offscreen images; click opens full-size; broken/relative srcs
// fall back to alt text (see MarkdownImage).
export function MarkdownImg({ src, alt, width, height }: MarkdownImgProps) {
  return (
    <MarkdownImage
      src={typeof src === 'string' ? src : undefined}
      alt={typeof alt === 'string' ? alt : ''}
      width={width}
      height={height}
    />
  )
}
