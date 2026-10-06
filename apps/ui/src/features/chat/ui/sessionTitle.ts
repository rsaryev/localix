import { sessionRef, type UiSession } from '@/shared/api/contracts'
import { compactSessionTitle } from '@localixai/api/session-title'

/**
 * What a conversation is CALLED on screen.
 *
 * One rule, because a conversation is named in several places at once and they have to agree: the
 * sidebar row, the "Found in messages" hit for that same row, and — since a delete now asks first —
 * the confirmation naming what is about to go. The rule had been transcribed at each of them, which
 * is how a fourth copy would have started.
 *
 * An untitled session shows its short `LOCALIX-<seq>` ref rather than a bare "Untitled": it is
 * token-cheap, stable across renames, and something a person can actually say out loud — and never
 * the long UUID. `titleFor` in `runtimeSessionMeta.ts` stays separate: a job or a sub-agent has no
 * `seq` to fall back to and is named for its KIND instead.
 */
export function sessionTitle(session: Pick<UiSession, 'title' | 'seq'>): string {
  return (
    compactSessionTitle(session.title ?? '', session.seq) ||
    (session.seq ? sessionRef(session.seq) : 'Untitled Chat')
  )
}
