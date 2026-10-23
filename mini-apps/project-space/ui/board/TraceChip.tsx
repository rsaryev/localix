import { ArrowDownRight, ArrowUpLeft, X } from 'lucide-react'
import type { SpaceDocument } from '../../shared/format/document'
import { elementName } from '../../shared/graph/names'
import { spaceTypes } from '../../shared/types'
import { Chip } from '../camera/CameraChips'
import type { BoardReading } from './useReading'

/**
 * A trace in progress, said in the strip above the board: which way, from what, and how far it
 * reached — the counts are the answer the person asked for, so they are on the chip, not behind a
 * click. Pressing it turns the trace around; its ✕ (or Escape) ends it.
 */
export function traceSummary(space: SpaceDocument, reading: BoardReading): string | null {
  const { trace, lit } = reading
  if (!trace || lit?.kind !== 'trace') return null
  const found = lit.elements.size - 1
  const way = trace.direction === 'upstream' ? 'Upstream of' : 'Downstream of'
  const name = elementName(space, spaceTypes, trace.origin, 32)
  return `${way} ${name} · ${found} element${found === 1 ? '' : 's'} · ${lit.hops} hop${lit.hops === 1 ? '' : 's'}`
}

export function TraceChip({ space, reading }: { space: SpaceDocument; reading: BoardReading }) {
  const summary = traceSummary(space, reading)
  const trace = reading.trace
  if (!summary || !trace) return null
  const other = trace.direction === 'upstream' ? 'downstream' : 'upstream'
  const Icon = trace.direction === 'upstream' ? ArrowUpLeft : ArrowDownRight
  return (
    <span className="pointer-events-auto flex max-w-full min-w-0 items-center gap-0.5">
      <Chip
        active
        title={`Trace ${other} instead`}
        onClick={() => reading.toggleTrace(trace.origin, other)}
      >
        <Icon aria-hidden className="size-3.5" />
        <span className="max-w-80 truncate">{summary}</span>
      </Chip>
      <Chip title="End the trace (Escape)" onClick={() => reading.clearTrace()}>
        <X aria-hidden className="size-3.5" />
        <span className="sr-only">End the trace</span>
      </Chip>
    </span>
  )
}
