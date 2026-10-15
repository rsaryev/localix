/**
 * ONE PARTICIPANT ON THE STRIP: who it is, where it stands in the live order, and the two
 * controls it carries (select it, remove it).
 *
 * Split from `ParticipantsStrip.tsx`, which held both the roster and everything one name on it
 * draws. They answer different questions: the strip decides WHO stands WHERE (it reads the
 * floor), while a chip only renders the standing it is handed. Keeping them in one file meant a
 * change to the beam or the select click was reviewed against the row layout it never touches.
 */
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@localixai/kit/button'

import { LocalixBorderBeam } from '@localixai/kit/localix-border-beam'
import { MonogramAvatar } from '@localixai/kit/avatar'
import { useAgentHandleIdentity } from '@/shared/contrib/useAgentIdentity'
import { answerClock } from '../../model/answerClock'
import { formatAnswerDuration } from './formatAnswerDuration'

function AnswerDuration({ sessionId, agentId }: { sessionId: string; agentId: string }) {
  const [startedAt] = useState(() => answerClock.startedAt(sessionId, agentId))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    // A fixed width: "9sec" → "10sec" → "1m5sec" must not push the chips beside it.
    <span aria-hidden="true" className="ml-1 w-10 shrink-0 text-3xs tabular-nums text-text-faint">
      {formatAnswerDuration(now - startedAt)}
    </span>
  )
}

/**
 * Only what a roster needs: who they are. Deliberately NOT the full participant route — the
 * strip has no business knowing which model anyone runs on, and a narrower prop is what lets
 * the composer hand it the projection it already holds.
 */
export interface StripParticipantRef {
  agentId: string
  handle: string
}

/** A participant's place in the live order: speaking, Nth in line, or not in this round at all. */
export type Standing = { kind: 'speaking' } | { kind: 'waiting'; place: number } | { kind: 'idle' }

/** What a screen reader hears instead of the beam and the number. */
function standingLabel(name: string, standing: Standing): string {
  if (standing.kind === 'speaking') return `${name}, answering now`
  if (standing.kind === 'waiting') return `${name}, number ${standing.place} in line`
  return name
}

export function ParticipantChip({
  participant,
  standing,
  showDuration,
  dimmed,
  onRemove,
  sessionId,
  selected = false,
  onSelect,
}: {
  participant: StripParticipantRef
  standing: Standing
  showDuration: boolean
  /** A round is running and this participant is not in it. */
  dimmed: boolean
  onRemove?: (agentId: string) => void
  sessionId?: string | null
  /** This participant's model is the one the composer's model picker shows. */
  selected?: boolean
  onSelect?: (agentId: string) => void
}) {
  const identity = useAgentHandleIdentity(participant.handle)
  const mention = (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      className="focus-ring inline-flex h-full min-w-0 items-center gap-1 rounded-sm px-0"
      aria-label={`${standingLabel(identity.name, standing)}. Show model`}
      title={`Show @${participant.handle}'s model`}
      disabled={!onSelect}
      aria-pressed={onSelect ? selected : undefined}
      // Selects only. It used to stage `@handle` too, so switching between participants piled
      // handles up in the draft; addressing someone is written, not clicked.
      onClick={() => onSelect?.(participant.agentId)}
    >
      {/* The place in line sits ON the avatar, so being queued never changes the chip's width and
          the row beside it stays still. */}
      <span className="relative inline-flex shrink-0">
        <MonogramAvatar identity={identity.handle} label={identity.name} size={18} />
        {standing.kind === 'waiting' ? (
          // The place in line, not a generic "queued" mark: with three participants waiting,
          // which one is next is the only part of the queue the person can act on.
          <span
            aria-hidden
            className="absolute -right-1 -bottom-1 inline-flex min-w-3 justify-center rounded-full bg-surface-active px-0.5 text-3xs leading-3 text-text-soft tabular-nums"
          >
            {standing.place}
          </span>
        ) : null}
      </span>
      <span
        className={
          standing.kind === 'speaking'
            ? 'max-w-32 truncate text-2xs text-text-strong'
            : 'max-w-32 truncate text-2xs text-text-soft'
        }
      >
        {identity.name}
      </span>
      {showDuration && sessionId ? (
        <AnswerDuration key={sessionId} sessionId={sessionId} agentId={participant.agentId} />
      ) : null}
    </Button>
  )
  return (
    <span
      data-slot="participant-chip"
      className={[
        'group/member relative inline-flex h-[var(--chrome-control-sm)] shrink-0 items-center gap-0.5 rounded-md pl-0.5 transition-[background-color,opacity,filter] duration-(--dur-moderate)',
        // A solid active fill made the speaker a grey slab inside the glass composer.
        // Borrow its material; the travelling beam already identifies the live participant.
        selected
          ? 'bg-surface-active'
          : 'bg-transparent hover:bg-surface-hover focus-within:bg-surface-hover',
        // The ones this round never asked for recede. Opacity, not a colour, because the
        // difference is attention and not category.
        dimmed ? 'opacity-40' : 'opacity-100',
      ].join(' ')}
    >
      {/*
        THE SPEAKER IS MARKED THE WAY THE COMPOSER MARKS ITSELF: the accent travelling around its
        edge. The same primitive, so live work looks like live work everywhere in the product
        rather than a second vocabulary per surface.
        A queued participant gets the SAME beam, turned down — slower and faint. One vocabulary
        with two weights says what two different effects would only have implied: these are the
        same state at different distances, and the bright one is the one costing money now. The
        difference has to survive being read at a glance, which is why it is intensity and not a
        hue: a strip this small has no room for a colour legend.
      */}
      <LocalixBorderBeam
        active={standing.kind !== 'idle'}
        variant={standing.kind === 'speaking' ? 'working' : 'focus'}
        intensity={standing.kind === 'speaking' ? 4 : 1}
      />
      {mention}
      {/*
        THE SLOT IS ALWAYS THERE, whether or not this participant can be removed. The
        orchestrator never can, and a chip that simply left the button out was narrower on its
        right than every other chip beside it — so the row's first participant sat visibly off the
        line the others shared. An empty span of the same width costs nothing and keeps the row
        even.
      */}
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          // A quiet but always discoverable target also works without hover on touch devices.
          className="focus-ring inline-flex size-[var(--chrome-control-xs)] shrink-0 items-center justify-center rounded-sm text-text-faint outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:text-foreground"
          aria-label={`Remove ${identity.name}`}
          onClick={() => onRemove(participant.agentId)}
        >
          <X />
        </Button>
      ) : (
        <span aria-hidden className="inline-block size-[var(--chrome-control-xs)] shrink-0" />
      )}
    </span>
  )
}
