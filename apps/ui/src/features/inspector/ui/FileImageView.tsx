import { useCallback, useRef, useState } from 'react'
import { ImageOff, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { CodeBlock } from '@/shared/ui/code-block/CodeBlock'
import { StateNotice } from '@localixai/kit/state-notice'
import { ActionPill } from '@localixai/kit/action-pill'
import { CopyContentButton, SourceToggle } from './FileViewerControls'
import { formatModifierText } from '@/shared/lib/keybindings'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { useImagePan } from './useImagePan'
import {
  type ImageScale,
  PIXELATION_THRESHOLD,
  clampScale,
  nextZoomIn,
  nextZoomOut,
  zoomLabel,
} from './imageZoom'

interface FileImageViewProps {
  path: string
  content: string
  mimeType: string
  encoding?: 'utf8' | 'base64'
  truncated: boolean
}

/**
 * Read-only image preview branch of the inspector file panel. SVGs (which arrive as utf8 text) can flip between
 * rendered and raw markup. The rendered image supports a proper zoom ladder:
 * Fit ⇄ discrete stops via the toolbar or click, free zoom via ⌘/Ctrl+wheel,
 * and drag-to-pan when magnified past the pane. State resets per file because
 * the parent remounts this on path change.
 */
export function FileImageView({
  path,
  content,
  mimeType,
  encoding,
  truncated,
}: FileImageViewProps) {
  // Current zoom: 'fit' scales the image to the pane; a number is an explicit
  // multiple of the image's natural pixel size (the container then scrolls).
  const [scale, setScale] = useState<ImageScale>('fit')
  // SVG only: show the raw markup instead of the rendered image.
  const [showSource, setShowSource] = useState(false)

  const imgRef = useRef<HTMLImageElement>(null)
  // Displayed/natural ratio while fitting — the base for the first zoom step so
  // zooming in from Fit snaps to the next stop above what's currently on screen.
  const fitRatioRef = useRef(1)
  // Intrinsic pixel size, learned on load (0 for SVGs with only a viewBox).
  // State (not a ref) because the numeric-zoom style is derived from it at render.
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const isFit = scale === 'fit'
  const { isPanning, wasPanned, onPointerDown, onLostPointerCapture } = useImagePan(
    !isFit && !showSource && !truncated,
  )

  const zoomInStep = useCallback(() => {
    setScale((s) => nextZoomIn(s === 'fit' ? fitRatioRef.current || 1 : s))
  }, [])
  const zoomOutStep = useCallback(() => {
    setScale((s) => nextZoomOut(s === 'fit' ? fitRatioRef.current || 1 : s))
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    // Only ⌘/Ctrl+wheel zooms; a plain wheel scrolls/pans the container.
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    setScale((s) => {
      const base = s === 'fit' ? fitRatioRef.current || 1 : s
      const delta = e.deltaY > 0 ? 1 : -1
      return clampScale(base * (1 - delta * 0.1))
    })
  }, [])

  const onImageClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail > 0 && wasPanned()) return // pointer drag, while assistive clicks still zoom
      if (e.altKey || e.metaKey) zoomOutStep()
      else zoomInStep()
    },
    [wasPanned, zoomInStep, zoomOutStep],
  )

  const onImgLoad = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    if (img.naturalWidth) fitRatioRef.current = img.clientWidth / img.naturalWidth || 1
  }, [])

  if (truncated) {
    return <StateNotice icon={ImageOff} title="Image too large to preview" />
  }
  // SVG arrives as utf8 text, so it can be viewed rendered OR as raw markup.
  const isSvgText = encoding !== 'base64'
  const src =
    encoding === 'base64'
      ? `data:${mimeType};base64,${content}`
      : `data:${mimeType};utf8,${encodeURIComponent(content)}`

  const pixelated = !isFit && scale >= PIXELATION_THRESHOLD
  const zoomOutGesture = `${formatModifierText('alt')}-click`
  // Numeric zoom: prefer explicit pixel width (crisp, scrollable). SVGs without
  // an intrinsic size fall back to the non-standard CSS `zoom` on the element.
  const imgStyle: React.CSSProperties = isFit
    ? {}
    : natural.w
      ? {
          width: natural.w * scale,
          height: natural.h ? natural.h * scale : undefined,
          maxWidth: 'none',
        }
      : { zoom: scale, maxWidth: 'none' }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {!showSource && (
        <WorkbenchToolbar aria-label="Image viewer actions" density="slim" wrap>
          <WorkbenchToolbarSection align="end" spacing="compact" wrap>
            <ActionPill
              title={`Zoom out (${formatModifierText('alt')}-click image)`}
              aria-label={`Zoom out (${formatModifierText('alt')}-click image)`}
              onClick={zoomOutStep}
            >
              <ZoomOut className="size-3" />
            </ActionPill>
            {/* Reads as engaged whenever the zoom is off Fit — i.e. when clicking it does something. */}
            <ActionPill
              title="Reset to fit"
              onClick={() => setScale('fit')}
              active={!isFit}
              className="min-w-[3.25rem] justify-center"
            >
              {zoomLabel(scale)}
            </ActionPill>
            <ActionPill
              title="Zoom in (click image)"
              aria-label="Zoom in (click image)"
              onClick={zoomInStep}
            >
              <ZoomIn className="size-3" />
            </ActionPill>
            <ActionPill
              title="Fit to panel"
              aria-label="Fit to panel"
              onClick={() => setScale('fit')}
              active={!isFit}
              disabled={isFit}
            >
              <Maximize2 className="size-3" />
            </ActionPill>
            {isSvgText && (
              <SourceToggle showSource={showSource} onToggle={() => setShowSource((v) => !v)} />
            )}
            {isSvgText && <CopyContentButton text={content} />}
          </WorkbenchToolbarSection>
        </WorkbenchToolbar>
      )}
      {isSvgText && showSource && (
        <WorkbenchToolbar aria-label="Image source actions" density="slim">
          <WorkbenchToolbarSection align="end" spacing="compact">
            <SourceToggle showSource={showSource} onToggle={() => setShowSource((v) => !v)} />
            <CopyContentButton text={content} />
          </WorkbenchToolbarSection>
        </WorkbenchToolbar>
      )}
      {isSvgText && showSource ? (
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <CodeBlock code={content} language="xml" bare />
        </div>
      ) : (
        <div
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onLostPointerCapture={onLostPointerCapture}
          className={`flex min-h-0 flex-1 overflow-auto scrollbar-thin p-4 ${isFit ? 'items-center justify-center' : `touch-none select-none ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}`}
        >
          {/* A real button owns the zoom gesture and keys; fitting, it spans the pane so the image can
              shrink inside it, zoomed it hugs the image so the pane scrolls and pans around it. */}
          <button
            type="button"
            aria-label={isFit ? 'Zoom image in' : `Zoom image in (${zoomOutGesture} to zoom out)`}
            title={
              isFit
                ? 'Click to zoom in'
                : `Click to zoom in · ${zoomOutGesture} to zoom out · drag to pan`
            }
            onClick={onImageClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                if (e.altKey) zoomOutStep()
                else zoomInStep()
              } else if (e.key === '0') {
                e.preventDefault()
                setScale('fit')
              }
            }}
            className={`rounded-sm outline-none focus-ring ${isFit ? 'flex h-full w-full cursor-zoom-in items-center justify-center' : 'block shrink-0 cursor-inherit'}`}
          >
            <img
              ref={imgRef}
              src={src}
              alt={path}
              onLoad={onImgLoad}
              draggable={false}
              style={imgStyle}
              className={`block transition-[filter] ${isFit ? 'max-h-full max-w-full object-contain hover:brightness-95' : 'cursor-inherit'} ${pixelated ? '[image-rendering:pixelated]' : ''}`}
            />
          </button>
        </div>
      )}
    </div>
  )
}
