/**
 * WHO IS IN THIS CONVERSATION and which addressed turns are pending.
 *
 * It is a strip rather than a header item because the participant list is session state, exactly
 * like the active loops and the queued turns beside it: it belongs to this conversation, changes
 * while you are in it, and is worth a glance rather than a click.
 *
 * It is rendered for every conversation so participants can always be added or removed.
 *
 * It also carries the LIVE ORDER. A conversation answers one participant at a time and a turn
 * takes as long as a model call, so six participants with nothing drawn on them are a still list
 * while minutes and money are spent. The participant speaking gets the accent travelling around
 * its edge — the composer's own beam (`shared/ui/localix-border-beam`), because live work should
 * look the same wherever it happens — the ones queued behind carry their place in line, and the
 * rest recede. All of it on the names already here: the queue is a fact about these participants,
 * and a second list of the same names in a different order is two things to reconcile.
 *
 * The strip also DRAWS them in that order: a sideways-scrolling roster kept in roster order left
 * the speaker at or past the right edge, so the speaker leads, the queue follows, and the rest
 * keep the places they had (`model/participantOrder`).
 *
 * User addressing and explicit `conversation_control` requests feed the same durable queue, so
 * this strip renders scheduler state instead of owning another ordering rule.
 */
import { useEffect, useRef, useState } from 'react'
import { motionSafeScrollBehavior } from '@localixai/kit/environment'

import { useFlipReorder } from '@/shared/hooks/useFlipReorder'
import { answerClock } from '../../model/answerClock'
import { floorIsRunning, liveParticipantOrder, sameOrder } from '../../model/participantOrder'
import { ParticipantChip, type Standing, type StripParticipantRef } from './ParticipantChip'

// The roster's element type, re-exported so the composer types its props from the strip it renders.
export type { StripParticipantRef } from './ParticipantChip'

/**
 * The live order derived from the active run and addressed items in the global queue.
 */
export interface ConversationFloor {
  speaking: string | null
  waiting: string[]
}

export interface ParticipantsStripProps {
  participants: readonly StripParticipantRef[]
  /** Whether this session's answer stream is still active. */
  isGenerating?: boolean
  /**
   * WHO IS ANSWERING AND WHO IS NEXT, drawn onto the participants already on screen.
   *
   * A conversation answers one participant at a time and a turn can take minutes, so six
   * participants with no order on them leave the person watching a still list while the cost
   * runs. Rendering it here rather than as a second strip is the point: the queue is a fact ABOUT
   * these participants, and a separate list of the same names in a different order is two things
   * to reconcile.
   */
  floor?: ConversationFloor | null
  /**
   * The control that adds someone, rendered after the last participant. A NODE rather than a
   * callback: who may be added is a question about the agent registry and the participant bound,
   * and the roster has no business holding either — it knows who is here and nothing else.
   */
  addControl?: React.ReactNode
  /** Removes one participant. Absent makes the roster read-only. */
  onRemove?: (agentId: string) => void
  /**
   * The participants are fixed. The roster recedes and loses its add and remove controls —
   * the server refuses both anyway, and a control that can only fail is a lie on screen.
   */
  locked?: boolean
  /**
   * The lock that fixes or opens the roster, beside the add control and OUTSIDE the scroller:
   * with six participants it would otherwise scroll off with the names it is about.
   */
  lockControl?: React.ReactNode
  /**
   * The session whose composer a clicked participant writes into. Passed explicitly so the insert
   * reaches THIS conversation's input rather than whichever composer happens to hold focus.
   */
  sessionId?: string | null
}

/**
 * A participant's standing, or `idle` for everyone when no round is running.
 *
 * `idle` covers two different things on purpose — a participant the round did not queue, and
 * every participant between rounds — because they look the same and mean the same to the reader:
 * nothing is being spent on you right now.
 */
function standingOf(agentId: string, floor: ConversationFloor | null | undefined): Standing {
  if (!floor) return { kind: 'idle' }
  if (floor.speaking === agentId) return { kind: 'speaking' }
  const place = floor.waiting.indexOf(agentId)
  return place >= 0 ? { kind: 'waiting', place: place + 1 } : { kind: 'idle' }
}

/**
 * The roster in its LIVE order (`model/participantOrder`), remembering the order last drawn.
 *
 * The previous order is what keeps the row still: without it every render would re-derive from
 * roster order, and the end of a round would move every chip back. It is kept per session — another
 * conversation's order says nothing about this one — and held in state rather than a ref, updated
 * during render only when the derived order differs (React's "adjust state on prop change"), so the
 * first paint of a new floor already has the new order.
 */
function useLiveOrder(
  participants: readonly StripParticipantRef[],
  floor: ConversationFloor | null | undefined,
  sessionId: string | null | undefined,
): StripParticipantRef[] {
  const scope = sessionId ?? null
  const [memo, setMemo] = useState<{ scope: string | null; order: string[] } | null>(null)
  const previous = memo?.scope === scope ? memo.order : null
  const roster = participants.map((participant) => participant.agentId)
  const order = liveParticipantOrder(roster, floor, previous)
  if (!previous || !sameOrder(previous, order)) setMemo({ scope, order })
  const byId = new Map(participants.map((participant) => [participant.agentId, participant]))
  return order.flatMap((id) => byId.get(id) ?? [])
}

export function ParticipantsStrip({
  participants,
  floor,
  isGenerating = false,
  addControl,
  onRemove,
  sessionId,
  locked = false,
  lockControl,
}: ParticipantsStripProps) {
  const running = floorIsRunning(floor)
  const remove = locked ? undefined : onRemove
  const ordered = useLiveOrder(participants, floor, sessionId)
  const scrollerRef = useRef<HTMLDivElement>(null)
  useFlipReorder(
    scrollerRef,
    ordered.map((participant) => participant.agentId),
    sessionId,
  )
  const speaking = floor?.speaking ?? null
  useEffect(() => {
    if (sessionId && (!isGenerating || !speaking)) answerClock.end(sessionId)
  }, [sessionId, isGenerating, speaking])
  // The speaker is now first, but a row scrolled sideways would still hide it: bring the start
  // back into view when the floor changes hands. Smooth, unless the person asked for less motion.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!speaking || !scroller || scroller.scrollLeft <= 0) return
    scroller.scrollTo({ left: 0, behavior: motionSafeScrollBehavior('smooth') })
  }, [speaking])
  return (
    // ONE ROW, ALWAYS. Six participants with long display names wrapped onto a second line and
    // pushed the add control under the first participant, so the strip changed height with the
    // roster and the composer below it jumped. The participants scroll sideways instead — a
    // roster is a list, and a list that does not fit scrolls.
    <div
      role="group"
      aria-label="Conversation participants"
      className="flex min-w-0 items-center gap-1.5 px-1.5 py-0.5"
    >
      {/*
        ROOM FOR THE EFFECTS. `overflow-x-auto` clips on BOTH axes, and the speaker's beam sits
        two pixels outside its chip with a blurred pass outside that — so on a tight row the
        glow was sliced flat along the top and bottom and the first participant's edge was cut by
        the scroll box. The padding is inside the scroller and pulled back out with a negative
        margin: the effects get their margin without the strip growing or the row shifting.
      */}
      {/*
        SHRINKS, NOT GROWS. With `flex-1` the scroller took the whole row and pushed the
        membership controls to its far end, away from the names they govern. Sized to its
        content, the controls follow the last participant; with too many names it still shrinks
        and scrolls, and the controls stay in view instead of scrolling off with them.
      */}
      {/*
        SPEAKER FIRST, WITHOUT A JUMP. The DOM order is the visual order (no CSS `order`, so focus
        and screen readers follow what is seen); a reorder is played as motion by
        `useFlipReorder` on the `data-flip-key` wrappers, so each chip slides to its new place.
      */}
      <div
        ref={scrollerRef}
        className="scrollbar-none -mx-1 flex min-w-0 shrink items-center gap-1.5 overflow-x-auto px-1 py-1.5"
      >
        {ordered.map((participant) => {
          const standing = standingOf(participant.agentId, floor)
          return (
            <div
              key={participant.agentId}
              data-flip-key={participant.agentId}
              className="flex shrink-0"
            >
              <ParticipantChip
                participant={participant}
                standing={standing}
                showDuration={isGenerating && standing.kind === 'speaking'}
                dimmed={running && standing.kind === 'idle'}
                fixed={locked && standing.kind !== 'speaking'}
                sessionId={sessionId}
                // A participant mid-turn is not removable; a pending or idle one can leave at once.
                onRemove={standing.kind !== 'speaking' ? remove : undefined}
              />
            </div>
          )
        })}
      </div>
      {/* After the last participant: that is where the list ends and where the eye is. Adding
          and whether anyone may be added are one question, so they sit together. */}
      <div className="flex shrink-0 items-center gap-1.5">
        {locked ? null : addControl}
        {lockControl}
      </div>
    </div>
  )
}
