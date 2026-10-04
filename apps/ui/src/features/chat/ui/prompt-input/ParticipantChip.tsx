/**
 * ONE PARTICIPANT ON THE STRIP: who it is, where it stands in the live order, and the two
 * controls it carries (mention it, remove it).
 *
 * Split from `ParticipantsStrip.tsx`, which held both the roster and everything one name on it
 * draws. They answer different questions: the strip decides WHO stands WHERE (it reads the
 * floor), while a chip only renders the standing it is handed. Keeping them in one file meant a
 * change to the beam or the mention click was reviewed against the row layout it never touches.
 */
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

import { composerBus } from '@/shared/lib/composerBus'
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
    <span aria-hidden="true" className="ml-1 text-3xs tabular-nums text-text-faint">
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
  fixed,
  onRemove,
  sessionId,
}: {
  participant: StripParticipantRef
  standing: Standing
  showDuration: boolean
  /** A round is running and this participant is not in it. */
  dimmed: boolean
  /** The roster is fixed and this participant is not answering right now. */
  fixed: boolean
  onRemove?: (agentId: string) => void
  sessionId?: string | null
}) {
  const identity = useAgentHandleIdentity(participant.handle)
  return (
    <span
      data-slot="participant-chip"
      className={[
        'group/member relative inline-flex h-[var(--chrome-control-sm)] shrink-0 items-center gap-0.5 rounded-md pl-0.5 transition-[background-color,opacity,filter] duration-(--dur-moderate)',
        // A solid active fill made the speaker a grey slab inside the glass composer.
        // Borrow its material; the travelling beam already identifies the live participant.
        'bg-transparent hover:bg-surface-hover focus-within:bg-surface-hover',
        // The ones this round never asked for recede. Opacity, not a colour, because the
        // difference is attention and not category.
        dimmed ? 'opacity-40' : fixed ? 'opacity-60' : 'opacity-100',
        // A fixed roster loses its colour, not its legibility: the names stay readable (they
        // are still who answers) while the grey says nothing about this list will change. The
        // speaker keeps its colour, because live work must never look paused.
        fixed ? 'grayscale' : '',
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
      {/*
        THE PARTICIPANT IS THE CONTROL FOR ADDRESSING IT. Naming someone in a user message creates
        an addressed queue ticket, so the queue is also a readout: seeing that a colleague is
        idle while the wrong one answers is precisely when a person wants to write their handle.
        Clicking stages `@handle` in this session's composer — the same bus every other
        prefill in the product goes through — and does not send, because who to ask is the
        person's decision and the rest of the sentence is still theirs to write.
      */}
      <button
        type="button"
        className="focus-ring inline-flex h-full min-w-0 items-center gap-1 rounded-sm"
        aria-label={`${standingLabel(identity.name, standing)}. Mention in the message`}
        title={`Mention @${participant.handle}`}
        disabled={!sessionId}
        onClick={() => {
          // The mention goes to THIS conversation's composer; a strip with no session has none.
          if (!sessionId) return
          composerBus.insert({
            text: `@${participant.handle} `,
            sessionId,
            // A handle joins the sentence being written, not a paragraph of its own.
            inline: true,
            buffer: true,
          })
        }}
      >
        <MonogramAvatar identity={identity.handle} label={identity.name} size={18} />
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
        {standing.kind === 'waiting' ? (
          // The place in line, not a generic "queued" mark: with three participants waiting,
          // which one is next is the only part of the queue the person can act on.
          <span
            aria-hidden
            className="ml-0.5 inline-flex min-w-3.5 justify-center rounded-full bg-field-fill px-1 text-3xs leading-4 text-text-faint tabular-nums"
          >
            {standing.place}
          </span>
        ) : null}
      </button>
      {/*
        THE SLOT IS ALWAYS THERE, whether or not this participant can be removed. The
        orchestrator never can, and a chip that simply left the button out was narrower on its
        right than every other chip beside it — so the row's first participant sat visibly off the
        line the others shared. An empty span of the same width costs nothing and keeps the row
        even.
      */}
      {onRemove ? (
        <button
          type="button"
          // A quiet but always discoverable target also works without hover on touch devices.
          className="focus-ring inline-flex size-[var(--chrome-control-xs)] shrink-0 items-center justify-center rounded-sm text-text-faint outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:text-foreground"
          aria-label={`Remove ${identity.name}`}
          onClick={() => onRemove(participant.agentId)}
        >
          <X className="size-3" />
        </button>
      ) : (
        <span aria-hidden className="inline-block size-[var(--chrome-control-xs)] shrink-0" />
      )}
    </span>
  )
}
