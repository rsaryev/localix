import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
// Registers <hyperframes-player>. This module is loaded lazily, so the player's code is fetched
// only when a film is actually opened.
import '@hyperframes/player'

export interface FilmPlayerProps {
  /** A composition `index.html`, or a video file when `type` is set. */
  src: string
  type?: 'video/mp4' | 'video/webm'
  width: number
  height: number
  label: string
  /** Changing it reloads the composition: the agent edited a source file. */
  reloadKey?: string
  /** A silent looping sample (gallery hover): no controls, no chrome, no error line. */
  ambient?: boolean
  /** Play on load and loop (a direction's sample film). */
  autoplay?: boolean
  /** Second to show once loaded, so a film whose first frames are dark does not look empty. */
  startAt?: number
}

/**
 * The film stage. The player is created imperatively: React has no typing for the custom element,
 * and a fresh element per source is the one reliable way to reload an iframe whose URL did not
 * change (the composition URL carries no query string, so relative asset paths keep resolving).
 *
 * `sandbox-origin="opaque"`: the composition is agent-authored HTML, so it runs without the
 * embedding page's origin and cannot reach the workbench DOM.
 */
export function FilmPlayer({
  src,
  type,
  width,
  height,
  label,
  reloadKey,
  ambient = false,
  autoplay = false,
  startAt,
}: FilmPlayerProps) {
  const host = useRef<HTMLDivElement>(null)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    const mount = host.current
    if (!mount) return
    setFailure(null)
    const player = document.createElement('hyperframes-player')
    player.setAttribute('sandbox-origin', 'opaque')
    if (ambient) {
      for (const flag of ['autoplay', 'muted', 'loop', 'audio-locked', 'disable-click-to-play'])
        player.setAttribute(flag, '')
      player.setAttribute('assets-loading-ui', 'none')
    } else {
      player.setAttribute('controls', '')
      if (autoplay) for (const flag of ['autoplay', 'muted', 'loop']) player.setAttribute(flag, '')
    }
    player.setAttribute('width', String(width))
    player.setAttribute('height', String(height))
    if (type) player.setAttribute('type', type)
    player.style.display = 'block'
    player.style.width = '100%'
    player.style.height = '100%'
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string } | undefined>).detail
      setFailure(detail?.message || 'The film could not be loaded.')
    }
    const onReady = () => {
      setFailure(null)
      if (startAt && !autoplay)
        (player as HTMLElement & { seek?: (t: number) => void }).seek?.(startAt)
    }
    player.addEventListener('error', onError)
    player.addEventListener('ready', onReady)
    player.setAttribute('src', src)
    mount.replaceChildren(player)
    return () => {
      player.removeEventListener('error', onError)
      player.removeEventListener('ready', onReady)
      player.remove()
    }
  }, [src, type, width, height, reloadKey, ambient, autoplay, startAt])
  if (ambient) return <div ref={host} role="img" aria-label={label} className="absolute inset-0" />
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        className="relative mx-auto w-full overflow-hidden rounded-md bg-foreground/[0.04]"
        // The parent sizes the stage (it fits the pane); the stage only keeps the film's aspect.
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <div ref={host} role="region" aria-label={label} className="absolute inset-0" />
      </div>
      {failure && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-status-error">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{failure}</span>
        </p>
      )}
    </div>
  )
}
