import type { InboxAction, InboxOrigin } from '../contracts'

/**
 * WHAT A SERVER PRODUCER KNOWS ABOUT THE SESSION A FACT HAPPENED IN, and the one ordered lane every
 * producer records through.
 *
 * The facts used to be derived in the browser from stream frames, so a closed window learned
 * nothing and two windows disagreed. Recording them where they happen needs two things the
 * browser had for free: the session's project and title (for the row's origin and body), and the
 * order the facts happened in. The first is a lookup, which is async; and an async lookup in front
 * of a raise lets a settle recorded a tick later (an answered request) overtake it — the journal
 * would settle nothing and then open a row for a question already answered. So every producer
 * task runs through ONE chain: a fact is handed to the journal only after every earlier fact was.
 */

/** The slice of a session record a producer reads. A `SessionRecord` satisfies it structurally. */
export interface SessionFacts {
  id: string
  projectId: string | null
  title?: string
  sessionKind: 'chat' | 'subagent' | 'job' | 'system'
  parentSessionId: string | null
  provenance: { kind: string }
}

export type LookupSession = (userId: string, sessionId: string) => Promise<SessionFacts | null>

/** A resource inside a session (a run, a request, a message) — what the row is ABOUT. */
export function resourceOrigin(
  session: Pick<SessionFacts, 'id' | 'projectId'>,
  resourceKind: string,
  resourceId: string,
  label: string,
): InboxOrigin {
  return {
    kind: 'resource',
    sessionId: session.id,
    projectId: session.projectId,
    resourceKind,
    resourceId,
    label,
  }
}

export function openChatAction(session: Pick<SessionFacts, 'id' | 'projectId'>): InboxAction {
  return {
    id: 'open',
    label: 'Open chat',
    kind: 'navigate',
    target: { kind: 'session', sessionId: session.id, projectId: session.projectId },
    available: true,
  }
}

/** A session that no longer exists still names its row; it just has no project to file under. */
export function unknownSession(sessionId: string): SessionFacts {
  return {
    id: sessionId,
    projectId: null,
    sessionKind: 'chat',
    parentSessionId: null,
    provenance: { kind: 'unknown-origin' },
  }
}

/** The session a row is about; a missing or unreadable one still names its row. */
export async function resolveSession(
  lookup: LookupSession,
  userId: string,
  sessionId: string,
): Promise<SessionFacts> {
  return (await lookup(userId, sessionId).catch(() => null)) ?? unknownSession(sessionId)
}

/**
 * An internal verifier job (a Claude Code hook's `agent` evaluator) is plumbing, not work anybody
 * asked for: its outcome is reported by the hook that ran it.
 */
export const isInternalSession = (session: Pick<SessionFacts, 'provenance'>) =>
  session.provenance.kind === 'hook'

export interface OrderedLane {
  /** Run `task` after every task queued before it. Never throws; a failed task is logged. */
  run(task: () => Promise<void> | void): void
  /** Resolves once every task queued so far has run (boot ordering, tests). */
  idle(): Promise<void>
}

export function createOrderedLane(
  log?: (event: string, detail: Record<string, unknown>) => void,
): OrderedLane {
  let tail: Promise<void> = Promise.resolve()
  return {
    run(task) {
      tail = tail.then(task).catch((error: unknown) => {
        log?.('notifications.producer_failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    },
    idle: () => tail,
  }
}
