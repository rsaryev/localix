import type { AttentionItem } from '@localixai/api/client'
import type { AgentStreamEvent, UiSession } from '@/shared/api/contracts'
import { toUiSessionSummary } from '@/shared/api/converters'

const timeOf = (item: AttentionItem): number => {
  const ms = Date.parse(item.at)
  return Number.isFinite(ms) ? ms : 0
}

/**
 * The requests the island may show: a blocked run waiting on the person, oldest first (its
 * deadline is the nearest). A plan or a mention does not block a run, so the island leaves both
 * to the app. `settled` holds the keys this window just answered, until the server's roster
 * agrees; the roster itself is never rewritten here.
 */
export function islandRequests(
  items: readonly AttentionItem[],
  settled: ReadonlySet<string>,
): AttentionItem[] {
  return items
    .filter((item) => item.kind === 'interaction' && !settled.has(item.key))
    .toSorted((a, b) => timeOf(a) - timeOf(b))
}

/** What the island needs to know of a conversation: its name, its project, whether it runs. */
export interface SessionBrief {
  title: string
  projectId: string | null
  running: boolean
}
export type SessionBriefs = ReadonlyMap<string, SessionBrief>

export function briefsFrom(
  sessions: readonly Pick<UiSession, 'id' | 'title' | 'projectId' | 'isRunning'>[],
): SessionBriefs {
  return new Map(
    sessions.map((session) => [
      session.id,
      {
        title: session.title ?? '',
        projectId: session.projectId ?? null,
        running: Boolean(session.isRunning),
      },
    ]),
  )
}

export const anyRunning = (briefs: SessionBriefs): boolean =>
  [...briefs.values()].some((brief) => brief.running)

/** Keep the briefs current from the user-wide stream, without any transcript. */
export function applyRunEvent(
  briefs: SessionBriefs,
  sessionId: string,
  event: AgentStreamEvent,
): SessionBriefs {
  if (event.type === 'session.deleted') {
    if (!event.sessionIds.some((id) => briefs.has(id))) return briefs
    return new Map([...briefs].filter(([id]) => !event.sessionIds.includes(id)))
  }
  const update = (id: string, change: Partial<SessionBrief>) => {
    const current = briefs.get(id) ?? { title: '', projectId: null, running: false }
    const next = { ...current, ...change }
    if (briefs.has(id) && next.running === current.running && next.title === current.title) {
      return briefs
    }
    return new Map(briefs).set(id, next)
  }
  if (event.type === 'session.updated' || event.type === 'child_session.updated') {
    const summary = toUiSessionSummary(event.session)
    return update(summary.id, {
      title: summary.title ?? '',
      projectId: summary.projectId ?? null,
      running: Boolean(summary.isRunning),
    })
  }
  if (event.type === 'run.started') return update(sessionId, { running: true })
  if (event.type === 'run.completed' || event.type === 'run.failed') {
    return briefs.has(sessionId) ? update(sessionId, { running: false }) : briefs
  }
  return briefs
}
