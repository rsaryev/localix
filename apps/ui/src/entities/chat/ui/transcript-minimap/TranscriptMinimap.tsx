import { useState } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { MINIMAP_MIN_MESSAGES, type MinimapTick } from './minimapModel'
import { tickOpacity, tickWidth, windowStart, WINDOW_SIZE } from './minimapWave'
import { useTranscriptTicks, type TickOffsets } from './useTranscriptTicks'

interface TranscriptMinimapProps {
  scrollEl: HTMLElement | null
  ticks: MinimapTick[]
  getOffsets: () => TickOffsets
  onJump: (rowIndex: number) => void
  sessionId: string | null
}

// Keeps a hovered card's ~3 clamped lines from spilling past the rail bottom.
const CARD_MAX_HEIGHT = 84
/** The rail's own hit column, wide enough to hover comfortably without covering prose. */
const RAIL_WIDTH = 22
/**
 * Distance between ticks. The rail is an EVENLY SPACED index of your questions, not a
 * proportional map of the scroll: mapping four messages onto a tall transcript spread them a
 * third of the viewport apart, which read as broken gaps rather than a control. A fixed rhythm
 * keeps the group compact and legible whether the conversation has four turns or forty.
 */
const TICK_GAP = 9

/**
 * Thin per-message tick rail along the transcript's left edge. Pointer-only
 * chrome: ticks are labeled buttons for AT, but tabIndex={-1} keeps this
 * secondary navigation out of the (long) transcript tab order.
 *
 * Rendered as a sticky zero-height layer INSIDE the virtualized transcript so
 * it pins to the scroll viewport without ChatSurface needing to know about it.
 */
export function TranscriptMinimap({
  scrollEl,
  ticks,
  getOffsets,
  onJump,
  sessionId,
}: TranscriptMinimapProps) {
  const layout = useTranscriptTicks(scrollEl, ticks.length, getOffsets, sessionId)
  const [hovered, setHovered] = useState<number | null>(null)

  if (ticks.length < MINIMAP_MIN_MESSAGES || layout.fractions.length !== ticks.length) return null

  // A WINDOW, not the whole conversation: only WINDOW_SIZE ticks exist at a time and the window
  // slides to stay centred on where you are reading. A million-message transcript therefore
  // renders the same 26 ticks a ten-message one does.
  const start = windowStart(layout.current, ticks.length)
  const windowTicks = ticks.slice(start, start + WINDOW_SIZE)
  // Centred group, sized by its own ticks — the rail is a compact control, not a full-height bar.
  const groupTop = Math.max(
    (layout.viewportHeight - (windowTicks.length - 1) * TICK_GAP) / 2,
    TICK_GAP,
  )
  const tickTop = (i: number) => groupTop + i * TICK_GAP
  const hoveredTick = hovered != null ? windowTicks[hovered] : undefined

  return (
    <div className="pointer-events-none sticky top-0 z-(--z-sticky) h-0 max-sm:hidden">
      <nav
        aria-label="Conversation minimap"
        data-slot="transcript-minimap"
        // In the RIGHT gutter, outside the prose column, so the rail never touches a message.
        // Hangs into the gutter, but never PAST the pane: `100cqw` is the scroll container's
        // width (it is a `@container`), `100%` the prose column's, so the offset is the real
        // gutter, capped at RAIL_WIDTH. A fixed `-RAIL_WIDTH` was 22px of content outside the
        // scroll box whenever the column filled the pane, and the transcript grew a horizontal
        // scrollbar.
        className="pointer-events-auto absolute top-0 right-[max(-22px,calc((100%-100cqw)/2))]"
        style={{
          width: RAIL_WIDTH,
          height: layout.viewportHeight,
          animation: 'fade-up var(--dur-base) var(--ease-soft) both',
        }}
      >
        {/* The mask lives on this INNER layer, never on the nav: a mask clips everything outside
            the element's own box, and with it on the nav the preview card — which opens outward —
            was masked away entirely. The gradient fades the column at both ends, so the strip
            reads as continuing past the viewport instead of being cut off at the first tick. */}
        <div
          // Fills the nav's box, so leaving it is leaving the rail; the nav itself stays a plain landmark.
          role="presentation"
          className="absolute inset-0"
          onMouseLeave={() => setHovered(null)}
          style={{
            maskImage:
              // `black` here is an ALPHA channel, not a colour: in a mask it means "keep these
              // pixels". Nothing theme-dependent to tokenise.
              'linear-gradient(to bottom, transparent 0, black 8%, black 92%, transparent 100%)',
            WebkitMaskImage:
              // `black` here is an ALPHA channel, not a colour: in a mask it means "keep these
              // pixels". Nothing theme-dependent to tokenise.
              'linear-gradient(to bottom, transparent 0, black 8%, black 92%, transparent 100%)',
          }}
        >
          {windowTicks.map((tick, i) => (
            <button
              key={tick.id}
              type="button"
              tabIndex={-1}
              // The label names the message's place in the CONVERSATION, not in the window.
              aria-label={`Jump to message ${start + i + 1}`}
              onMouseEnter={() => setHovered(i)}
              onClick={() => onJump(tick.index)}
              // The button is the hit target (h-3, full rail width); the bar inside is the
              // visual, so neighbouring hairline ticks stay comfortably clickable. Right-aligned,
              // because the rail sits in the right gutter: ticks share their RIGHT edge and grow
              // leftward, toward the prose, so the wave opens over margin rather than off-screen.
              className="absolute right-0 flex h-3 w-full -translate-y-1/2 items-center justify-end pr-1"
              style={{ top: tickTop(i) }}
            >
              <span
                aria-hidden="true"
                // Width and ink come from the wave curve, so a hover lifts the ticks AROUND the
                // pointer too. Transitioned (not animated) so the crest follows the pointer
                // continuously as it slides down the rail.
                className="h-px rounded-full bg-foreground transition-[width,opacity] duration-(--dur-base) ease-(--ease-emphasized)"
                style={{
                  width: tickWidth(i, hovered),
                  // `start + i` is the absolute tick, which is what the marker tracks.
                  opacity: tickOpacity(i, hovered, start + i === layout.current),
                }}
              />
            </button>
          ))}
        </div>
        {hoveredTick ? (
          <div
            data-slot="transcript-minimap-preview"
            // Opens LEFTWARD, back over the transcript: the rail is in the right gutter, so the
            // only direction with room inside this pane is inward.
            className={cn(
              'pointer-events-none absolute right-full mr-1 w-60 px-2.5 py-2',
              FLOATING_SURFACE,
            )}
            style={{
              top: Math.min(
                Math.max(tickTop(hovered!) - 14, TICK_GAP),
                Math.max(layout.viewportHeight - CARD_MAX_HEIGHT, TICK_GAP),
              ),
              animation: 'fade-up var(--dur-fast) var(--ease-emphasized) both',
            }}
          >
            {hoveredTick.excerpt ? (
              <div className="line-clamp-3 text-xs/relaxed text-text-soft">
                {hoveredTick.excerpt}
              </div>
            ) : (
              <div className="text-2xs text-text-faint">Empty message</div>
            )}
          </div>
        ) : null}
      </nav>
    </div>
  )
}
