import { api, databaseFile, verifyDemoRuntime } from './runtime.mjs'

/**
 * Write `rows` as the whole transcript of one session, each row the parent of the next, and point
 * the session's leaf at the last. Rewritten on every seed, so the conversation always renders
 * exactly these rows.
 */
export function writeTranscript(db, sessionId, idPrefix, rows, serializeMessagePayload) {
  db.query('DELETE FROM agent_messages WHERE session_id=?').run(sessionId)
  let parent = null
  for (const [index, row] of rows.entries()) {
    const id = `${idPrefix}-${sessionId}-${index}`
    db.query(
      'INSERT INTO agent_messages(id,session_id,user_id,sequence,role,payload_json,parent_id) VALUES (?,?,?,?,?,?,?)',
    ).run(
      id,
      sessionId,
      'local-user',
      index + 1,
      row.role,
      serializeMessagePayload({ id, ...row }),
      parent,
    )
    parent = id
  }
  const now = new Date().toISOString()
  db.query('UPDATE agent_sessions SET leaf_id=?,last_message_at=?,updated_at=? WHERE id=?').run(
    parent,
    now,
    now,
    sessionId,
  )
}

/**
 * Run by `seed.mjs` under Bun: find or create the capture project's session titled `title` and
 * write `rows` straight into the capture database as its transcript. Returns the session id.
 */
export async function seedTranscript(fixture, { title, label, idPrefix, rows }) {
  await verifyDemoRuntime()
  const { Database } = await import('bun:sqlite')
  const { serializeMessagePayload } = await import('../../apps/api/src/db/payload-codec.ts')
  const sessions = await api('/sessions')
  const list = Array.isArray(sessions) ? sessions : (sessions.sessions ?? [])
  const session =
    list.find((item) => item.title === title && item.projectId === fixture.projectId) ??
    (await api('/sessions', { title, projectId: fixture.projectId }))
  const db = new Database(databaseFile, { strict: true })
  try {
    const owner = db.query('SELECT project_id FROM agent_sessions WHERE id=?').get(session.id)
    if (owner?.project_id !== fixture.projectId)
      throw new Error(`The ${label} fixture must live in the dedicated capture project.`)
    writeTranscript(db, session.id, idPrefix, rows, serializeMessagePayload)
  } finally {
    db.close()
  }
  return session.id
}
