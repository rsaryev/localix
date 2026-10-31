import { useId, useState } from 'react'
import { COLLAPSIBLE_MOTION } from '@localixai/kit/collapsible-motion'
import { MessageText } from './MessageText'

interface MessageReasoningProps {
  text: string
  isStreaming?: boolean
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={[`size-3 ${COLLAPSIBLE_MOTION.chevron}`, open ? 'rotate-90' : ''].join(' ')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

/**
 * The model's private reasoning, shown as a deliberately distinct "thought" strip
 * — the muted italic label "Reasoning" and (when open) an indented body on a
 * dashed rail. The dashed rail + italic text separate it from tool tracks (solid
 * bordered cards), so a reader never confuses thinking with an actual tool
 * action. Always starts collapsed so streaming never shifts layout.
 */
export function MessageReasoning({ text, isStreaming = false }: MessageReasoningProps) {
  const [open, setOpen] = useState(false)
  const regionId = useId()

  if (!text.trim()) return null

  return (
    <div className="my-1 max-w-[min(85%,44rem)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={regionId}
        className="flex items-center gap-[0.4rem] border-none bg-transparent p-0 text-xs text-text-faint outline-none focus-ring transition-colors hover:text-text-soft cursor-pointer"
      >
        {/* Identity language: reasoning = italic label. Motion is reserved for
            the single bottom activity line so the same run never pulses twice. */}
        <ChevronIcon open={open} />
        <span className="italic">{isStreaming ? 'Reasoning…' : 'Reasoning'}</span>
      </button>

      <div
        id={regionId}
        className={[
          `grid overflow-hidden ${COLLAPSIBLE_MOTION.body}`,
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        ].join(' ')}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-[0.45rem] ml-[0.3rem] border-l border-dashed border-border pl-3 text-xs italic leading-relaxed text-text-faint">
            {open && <MessageText text={text} isStreaming={isStreaming} />}
          </div>
        </div>
      </div>
    </div>
  )
}
