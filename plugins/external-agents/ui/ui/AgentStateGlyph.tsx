import { CircleCheck } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Spinner } from '@localixai/kit/spinner'
import { stateDotClass, stateGlyphLabel } from '../model/stateTone'
import type { AgentState, StateAuthority } from '../model/types'

/**
 * What a live delegation is doing, as ONE glyph that sits beside the agent's own mark.
 *
 * Two glyphs, never one: the mark says WHO, this says WHAT. Fusing them into a single decorated
 * icon costs both — you can no longer scan a column for "which agent" or for "what is happening"
 * without reading every row.
 *
 * `working` is a spinner rather than a coloured dot because it is the only state that is ONGOING,
 * and motion is the one encoding a reader picks up without looking directly at it — which is the
 * entire question a roster of parallel delegations has to answer. `done` is a check for the
 * converse reason: an outcome should not be a dot that differs from `idle` only by hue.
 */
export function AgentStateGlyph({
  state,
  unconfirmed = false,
  authority,
  className,
}: {
  state: AgentState
  /**
   * `RosterRow.stateFallback` — the state is the manifest's no-match fallback. Only ever reaches the
   * dot branch: the evaluator returns `idle` when nothing matched, so a spinner or a check can never
   * be unconfirmed. Named for what it means to a reader, not for the mechanism that produced it.
   */
  unconfirmed?: boolean
  /** Where the state came from — see `stateGlyphLabel`. */
  authority?: StateAuthority
  className?: string
}) {
  const label = stateGlyphLabel(state, unconfirmed, authority)

  if (state === 'working') {
    return (
      <Spinner size="xs" label={label} className={cn('shrink-0 text-status-info', className)} />
    )
  }
  if (state === 'done') {
    return (
      <CircleCheck
        aria-label={label}
        className={cn('size-3 shrink-0 text-status-success', className)}
      />
    )
  }
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn('size-1.5 shrink-0 rounded-full', stateDotClass(state, unconfirmed), className)}
    />
  )
}
