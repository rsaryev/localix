import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { isFixedViewport, type PreviewViewportPreset } from '../model/previewViewportPresets'
import type { useNativeBrowserPage } from './useNativeBrowserPage'

/**
 * The box a native page is framed to, and what shows in it while the page steps aside.
 *
 * The page's picture lies under the page, so an app overlay opens over what the page last showed.
 * A pinned frame size shapes the box itself — the native page follows whatever box it is given —
 * but the box never outgrows the pane: a platform view cannot be clipped or scrolled like an
 * iframe, so a frame larger than the pane is shown at the pane's size.
 */
export function NativePageSurface({
  page,
  pageId,
  url,
  viewport,
}: {
  page: ReturnType<typeof useNativeBrowserPage>
  pageId: string
  url: string
  viewport: PreviewViewportPreset
}) {
  const { hostRef, picture, onPictureLoad, paused } = page
  const pinned = isFixedViewport(viewport)
  return (
    <div
      className={cn(
        'relative min-h-0 min-w-0 flex-1 overflow-hidden',
        // pane-ground-allow: the sunken fill is the LETTERBOX around a pinned frame, the same mat
        // the framed preview uses; it recedes behind the page instead of being the pane's ground.
        pinned && 'grid place-items-center bg-surface-sunken p-3',
      )}
    >
      <div
        ref={hostRef}
        data-native-page-id={pageId}
        aria-label={`Browser page: ${url}`}
        className={cn(
          'relative overflow-hidden',
          pinned
            ? 'max-h-full max-w-full ring-1 ring-border/60 shadow-(--shadow-soft)'
            : 'size-full',
        )}
        style={pinned ? { width: viewport.width!, height: viewport.height! } : undefined}
      >
        {picture && (
          <img
            src={picture}
            alt=""
            aria-hidden="true"
            draggable={false}
            onLoad={onPictureLoad}
            className="pointer-events-none absolute inset-0 size-full select-none object-fill"
          />
        )}
        {/* While paused, the picture takes on the app's own ground: every app surface is glass
            tuned to frost over that tone, and over a bright page it washes out instead. */}
        <div
          aria-hidden="true"
          data-paused={paused || undefined}
          className={cn(
            'pointer-events-none absolute inset-0 bg-background-solid/50 opacity-0 transition-opacity duration-(--dur-instant)',
            paused && 'opacity-100',
          )}
        />
      </div>
    </div>
  )
}
