/**
 * What a restart of the app would cut off, read from the roster the chat store already holds.
 *
 * Restarting to install an update ends the API process, and with it every agent turn in flight
 * and every background job it supervises: at the next boot the work registry marks each job
 * `lost`. The restart used to happen on one click with no word of that. So before it runs, the
 * person is told what will stop, and the answer comes from the same state the composer strips
 * render (`isRunning`, `work`) rather than from a second source that could disagree with them.
 *
 * Counted: a running turn of a top-level conversation (a sub-agent it awaits runs inside that
 * turn, and a detached one is already a `sub-N` work item), and every work item except a polled
 * monitor, the one kind a restart resumes (`features/work/registry.ts` `RESUMABLE`).
 *
 * Pure, and handed the roster rather than reading the store: it is loaded on the click
 * (`restartToUpdateFlow.ts`), and a lazy module importing the store would carry the store's
 * whole preload list into the startup chunk that loads it — costing more than it kept out.
 */
import type { UiSession } from '@/shared/api/contracts'

export interface InterruptibleWork {
  /** Titles of conversations with a turn in flight. */
  turns: string[]
  /** `bg-3 (bun run dev)` — the id the agent uses, then what it is. */
  work: string[]
}

export function collectInterruptibleWork(sessions: readonly UiSession[]): InterruptibleWork {
  const turns: string[] = []
  const work: string[] = []
  for (const session of sessions) {
    if (session.isRunning && !session.parentSessionId) {
      turns.push(session.title.trim() || 'Untitled conversation')
    }
    for (const item of session.work ?? []) {
      if (item.kind !== 'monitor') work.push(`${item.id} (${item.label})`)
    }
  }
  return { turns, work }
}

const MAX_NAMED = 3

function named(items: readonly string[]): string {
  const shown = items.slice(0, MAX_NAMED).join(', ')
  return items.length > MAX_NAMED ? `${shown} and ${items.length - MAX_NAMED} more` : shown
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The confirmation text, or null when nothing would be interrupted. */
export function describeInterruptibleWork({ turns, work }: InterruptibleWork): string | null {
  const parts: string[] = []
  if (turns.length > 0) {
    parts.push(`${plural(turns.length, 'agent turn', 'agent turns')} in ${named(turns)}`)
  }
  if (work.length > 0) {
    parts.push(`${plural(work.length, 'background job', 'background jobs')}: ${named(work)}`)
  }
  if (parts.length === 0) return null
  return (
    `Restarting stops ${parts.join(', and ')}. ` +
    'A stopped turn does not continue after the update, and a stopped job comes back marked lost.'
  )
}
