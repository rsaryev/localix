import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import type { LastMessagePreview } from './repository-types'

// The dialog list's preview line, and nothing else. Its own module because it is the only
// read here that reaches into `agent_messages` rather than `agent_sessions`, and because
// the session read-query module is already at its size pin.

/**
 * How much of a message a list row can ever show.
 *
 * Clamped HERE rather than in the client because the alternative is shipping a whole
 * conversation's last message — a plan, a diff, a stack trace — for every row in the list,
 * to render one ellipsized line. The cap is generous enough that no reasonable row is cut.
 */
const PREVIEW_MAX_CHARS = 160

/** One line: a preview that keeps its newlines would blow the row's fixed height. */
function previewText(raw: string): string {
  const line = raw.replace(/\s+/g, ' ').trim()
  return line.length > PREVIEW_MAX_CHARS ? `${line.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…` : line
}

/**
 * The last thing said in each of the user's sessions — one row per session.
 *
 * A dialog list without this can only show a title and a time, which is the same information
 * for every row. The preview is what makes the list scannable, and its AUTHOR says who spoke
 * last (the person or the agent), which a transport role cannot.
 *
 * `search_text` rather than re-reading `payload_json`: the FTS triggers already keep it as the
 * message's plain content, so the preview costs no JSON parse per row and cannot drift from
 * what search matches. Internal rows (a wake's hidden prompt) are excluded — they are not part
 * of the conversation the user is reading.
 *
 * One SQL statement seeks the visible tail of each session through its unique
 * `(session_id, sequence)` index. It does not parse every historical payload on each refresh.
 */
export function lastMessagesQuery(db: Kysely<AppDatabase>, userId: string) {
  return db
    .selectFrom('agent_sessions as s')
    .leftJoin('agent_messages as m', (join) =>
      join.on('m.id', '=', (eb) =>
        eb
          .selectFrom('agent_messages as tail')
          .select('tail.id')
          .whereRef('tail.session_id', '=', 's.id')
          .where('tail.user_id', '=', userId)
          .where(sql<boolean>`coalesce(json_extract(tail.payload_json, '$.isInternal'), 0) = 0`)
          .orderBy('tail.sequence', 'desc')
          .limit(1),
      ),
    )
    .select(['m.session_id', 'm.role', 'm.search_text', 'm.created_at'])
    .select(sql<string | null>`json_extract(m.payload_json, '$.from')`.as('from_ref'))
    .where('s.user_id', '=', userId)
}

export async function lastMessagesByUser(
  db: Kysely<AppDatabase>,
  userId: string,
): Promise<Map<string, LastMessagePreview>> {
  const rows = await lastMessagesQuery(db, userId).execute()

  return new Map(
    rows.flatMap((row) => {
      if (row.session_id === null || row.search_text === null || row.created_at === null) return []
      const text = previewText(row.search_text)
      if (!text) return []
      const from = row.from_ref ?? (row.role === 'user' ? 'user' : 'system')
      return [
        [
          row.session_id,
          {
            from,
            text,
            at: new Date(row.created_at).getTime(),
          },
        ] as const,
      ]
    }),
  )
}
