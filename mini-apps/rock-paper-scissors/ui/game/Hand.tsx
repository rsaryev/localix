import { CircleAlert, Lock, ShieldCheck, ShieldX } from 'lucide-react'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

import { shortDigest } from '../../shared/describe'
import type { Move } from '../../shared/game'
import { MOVE_GLYPH, MOVE_LABEL } from './copy'

/**
 * One side of the table: the hand itself and a caption under it — no card, no stage. The winner is
 * told by its lift and the caption's colour, the loser steps back. The agent's hand is mirrored to
 * face the person's.
 *
 * A hand is waiting (the orb while the agent chooses), sealed (a lock, with the digest the reveal
 * is checked against), or face up — the person's own move, tagged while still hidden from the
 * agent, or a revealed one, whose digest check the agent's side reports.
 */
export function Hand({
  title,
  side,
  move,
  digest,
  sealedFromOpponent = false,
  thinking = false,
  unreachable = false,
  verified = null,
  result,
  hiddenFrom = 'the agent',
}: {
  title: string
  side: 'left' | 'right'
  /** The move face up, when this viewer may see it. */
  move: Move | null
  /** The digest of a committed move this viewer may not see yet — or of the revealed one. */
  digest?: string
  /** The person's own move, committed but not yet shown to the agent. */
  sealedFromOpponent?: boolean
  thinking?: boolean
  unreachable?: boolean
  /** The browser's own check of a revealed digest; `null` when there is nothing to check. */
  verified?: boolean | null
  result?: 'winner' | 'loser' | 'draw'
  /** Who a sealed own move is hidden from: the other seat, in the person's words. */
  hiddenFrom?: string
}) {
  const faceDown = !move && digest !== undefined
  const label = move
    ? `${title}: ${MOVE_LABEL[move]}`
    : faceDown
      ? `${title}: sealed`
      : `${title}: not chosen yet`
  return (
    <figure aria-label={label} className="flex min-w-0 flex-1 flex-col items-center gap-3">
      <div
        className={cn(
          'flex h-32 items-center justify-center transition-opacity duration-(--dur-slow) ease-(--ease-soft)',
          result === 'loser' && 'opacity-35',
        )}
      >
        {move ? (
          <span
            key={move}
            className={cn('rps-glyph rps-reveal', result === 'winner' && 'rps-win')}
            aria-hidden
          >
            <span className={cn('inline-block', side === 'right' && '-scale-x-100')}>
              {MOVE_GLYPH[move]}
            </span>
          </span>
        ) : faceDown ? (
          <Lock className="rps-sealed size-12 text-text-soft" strokeWidth={1.5} aria-hidden />
        ) : thinking ? (
          <ActivityOrb className="size-8" />
        ) : unreachable ? (
          <CircleAlert className="size-10 text-status-warning" strokeWidth={1.5} aria-hidden />
        ) : (
          <span className="rps-glyph text-text-faint/40" aria-hidden>
            ?
          </span>
        )}
      </div>
      <figcaption className="flex min-h-11 flex-col items-center gap-1 text-center">
        <span className="text-xs text-text-faint">{title}</span>
        <span className={cn('text-sm font-medium', result === 'winner' && 'text-status-success')}>
          {move ? MOVE_LABEL[move] : faceDown ? 'Sealed' : thinking ? 'Choosing…' : 'Waiting'}
        </span>
        {sealedFromOpponent && (
          <span className="text-2xs text-text-faint">Hidden from {hiddenFrom}</span>
        )}
        {digest !== undefined && <DigestPill digest={digest} verified={verified} />}
      </figcaption>
    </figure>
  )
}

function DigestPill({ digest, verified }: { digest: string; verified: boolean | null }) {
  const Icon = verified === true ? ShieldCheck : verified === false ? ShieldX : Lock
  return (
    <span
      title={`SHA-256 ${digest}`}
      className={cn(
        'inline-flex items-center gap-1 text-2xs whitespace-nowrap',
        verified === true
          ? 'text-status-success'
          : verified === false
            ? 'text-status-error'
            : 'text-text-faint',
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {verified === true ? 'Digest checked' : verified === false ? 'Digest mismatch' : 'Digest'}
      <span className="font-mono opacity-70">{shortDigest(digest)}</span>
    </span>
  )
}
