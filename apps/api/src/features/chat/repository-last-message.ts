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
 * for every row. The preview is what makes the list scannable, and its AUTHOR is what a party
 * of several agents needs: the row says who spoke last, which a transport role cannot — an
 * agent's own line is `assistant` to itself and input to everyone else.
 *
 * `search_text` rather than re-reading `payload_json`: the FTS triggers already keep it as the
 * message's plain content, so the preview costs no JSON parse per row and cannot drift from
 * what search matches. Internal rows (a wake's hidden prompt) are excluded — they are not part
 * of the conversation the user is reading.
 *
 * One grouped query joined back on `(session_id, sequence)` — the table's own unique
 * constraint — rather than a query per session.
 */
export async function lastMessagesByUser(
  db: Kysely<AppDatabase>,
  userId: string,
): Promise<Map<string, LastMessagePreview>> {
  const latest = db
    .selectFrom('agent_messages')
    .select('session_id')
    .select((eb) => eb.fn.max('sequence').as('sequence'))
    .where('user_id', '=', userId)
    .where(sql<boolean>`coalesce(json_extract(payload_json, '$.isInternal'), 0) = 0`)
    .groupBy('session_id')
    .as('latest')

  const rows = await db
    .selectFrom('agent_messages as m')
    .innerJoin(latest, (join) =>
      join
        .onRef('latest.session_id', '=', 'm.session_id')
        .onRef('latest.sequence', '=', 'm.sequence'),
    )
    .select(['m.session_id', 'm.role', 'm.search_text', 'm.created_at'])
    .select(sql<string | null>`json_extract(m.payload_json, '$.from')`.as('from_ref'))
    .select(
      sql<string | null>`json_extract(m.payload_json, '$.authorSnapshot.handle')`.as(
        'author_handle',
      ),
    )
    .where('m.user_id', '=', userId)
    .execute()

  return new Map(
    rows.flatMap((row) => {
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
            ...(row.author_handle ? { authorSnapshot: { handle: row.author_handle } } : {}),
          },
        ] as const,
      ]
    }),
  )
}
