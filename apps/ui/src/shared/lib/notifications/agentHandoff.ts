import { createMessageBindingDraft } from '@localixai/plugin-sdk/ui'

import { composerBus } from '@/shared/lib/composerBus'
import { pageOpenChatOrNotify } from '@/shared/lib/pageOpenChat'
import type { NotificationEntry } from './types'

/**
 * Handing a problem to the agent.
 *
 * The Event Center already holds the only complete account of a failure — what is wrong, in which
 * field, on which line, and what to write instead. Until now the person had to retype that into the
 * composer, which meant the agent worked from a paraphrase of a report the app had already written
 * perfectly well.
 *
 * Nothing new was needed to fix that. A `snippet` binding is the one context kind whose payload
 * travels from the client verbatim — the server has nothing to re-read for a row that lives in this
 * browser — and the composer already accepts one from any producer. So this is a translation, not a
 * mechanism: the same route `askAgentAboutHunk` uses to hand over a diff.
 *
 * Deliberately never auto-sends. The person attaches the problem and says what they want done with
 * it; an agent that starts working the moment you click a notification is a worse product than one
 * that waits to be asked.
 */

/** The report as the model should read it: the headline, then the detail lines as written. */
export function problemHandoffText(entry: NotificationEntry): string {
  const where = entry.origin.label ? ` (${entry.origin.label})` : ''
  return [`Problem reported by Localix${where}: ${entry.title}`, entry.message]
    .filter(Boolean)
    .join('\n')
}

/**
 * Attach one Event Center problem to the composer as context — of the chat the problem came from
 * (its origin), else of the chat that is open. Handing it to whichever composer had focus put a
 * problem raised by chat A into chat B's draft. With neither, it says so and attaches nothing.
 */
export function sendProblemToAgent(entry: NotificationEntry): void {
  const sessionId =
    entry.origin.kind === 'application' ? pageOpenChatOrNotify() : entry.origin.sessionId
  if (!sessionId) return
  composerBus.insert({
    sessionId,
    bindings: [
      createMessageBindingDraft('snippet', entry.title, entry.title, {
        content: problemHandoffText(entry),
      }),
    ],
  })
}
