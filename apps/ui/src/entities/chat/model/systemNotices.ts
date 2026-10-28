import type { Message, SystemNotice, SystemNoticeKind } from './types'

/**
 * Centralized builders for compact inline system notices (centered lines
 * in the chat timeline). All notice creation flows through here so wording,
 * tone, and icons stay consistent across the app.
 */

let counter = 0
function noticeId(kind: SystemNoticeKind): string {
  counter += 1
  return `sys-${kind}-${Date.now()}-${counter}`
}

/** Wrap a SystemNotice in a renderable Message. */
export function systemNoticeMessage(notice: SystemNotice): Message {
  // `clientOnly` is what makes the notice survive a whole-body replace: no backend body
  // can contain this row, so `mergeSessionBody` must carry it forward.
  return { id: noticeId(notice.kind), role: 'system', clientOnly: true, systemNotice: notice }
}

/**
 * Only ONE notice is still drawn here, and the rule behind that is worth stating.
 *
 * A model change and a reasoning change are facts about the conversation that the AGENTS have to
 * read as well — so the server writes them, as ordinary rows that also render as notices, naming
 * the agent they are about (`runtime/session-notice.ts`). A client-only copy of an event
 * the server already records would print it twice and, worse, disagree with it about whose
 * change it was.
 *
 * A connection switch is the exception: which credentials a model is reached through is an
 * account fact the conversation cannot act on, so it is shown to the person and to nobody else.
 */
export const systemNotices = {
  connectionChange(label: string): Message {
    return systemNoticeMessage({
      kind: 'connection_change',
      tone: 'info',
      text: `Connection switched to ${label}`,
    })
  },
}
