import { promises as fs } from 'node:fs'
import { expect } from '@playwright/test'
import { openConversation } from './codemode-card.mjs'
import { api, databaseFile, fixtureFile, uiOrigin, verifyDemoRuntime } from './runtime.mjs'

const TITLE = 'Unfinished reply fixture'
const CUT_OFF =
  'Interrupted: the server restarted while this was running. It may or may not have taken effect.'
const NOTICE =
  'Backend restarted while bash was still running — this reply is incomplete, and that call may or may not have taken effect. Check before retrying.'

/**
 * A reply a restart cut off while its `bash` call was running: the transcript marks where it
 * stopped, and the composer offers Continue. Illustrative fixture state, written the way the boot
 * sweep writes it (`chat/runtime/interrupted-runs.ts`).
 */
const rows = [
  { role: 'user', content: 'Run the migrations and tell me what changed.' },
  {
    role: 'assistant',
    content: 'Running the migrations.',
    items: [
      {
        type: 'text',
        id: 'unfinished-capture-text',
        status: 'completed',
        text: 'Running the migrations.',
      },
      {
        id: 'unfinished-capture-bash',
        type: 'tool_call',
        // Settled by the boot sweep: nothing will end it, so it no longer spins.
        status: 'aborted',
        toolCallId: 'tc-unfinished-capture-1',
        name: 'bash',
        activeVerb: 'Running',
        input: { command: 'bun run db:migrate' },
        errorText: CUT_OFF,
        error: {
          kind: 'aborted',
          code: 'PROCESS_RESTART',
          message: CUT_OFF,
          userMessage: 'Interrupted by a restart',
        },
      },
    ],
  },
  {
    role: 'user',
    uiOnly: true,
    content: NOTICE,
    systemNotice: { kind: 'run_interrupted', tone: 'warning', text: NOTICE, recovery: ['retry'] },
  },
]

/** Run by `seed.mjs` under Bun: it writes the transcript straight into the capture database. */
export async function seedUnfinishedReply(fixture) {
  await verifyDemoRuntime()
  const { Database } = await import('bun:sqlite')
  const { serializeMessagePayload } = await import('../../apps/api/src/db/payload-codec.ts')
  const sessions = await api('/sessions')
  const list = Array.isArray(sessions) ? sessions : (sessions.sessions ?? [])
  const session =
    list.find((item) => item.title === TITLE && item.projectId === fixture.projectId) ??
    (await api('/sessions', { title: TITLE, projectId: fixture.projectId }))
  const db = new Database(databaseFile, { strict: true })
  try {
    const owner = db.query('SELECT project_id FROM agent_sessions WHERE id=?').get(session.id)
    if (owner?.project_id !== fixture.projectId)
      throw new Error('The unfinished-reply fixture must live in the dedicated capture project.')
    // Rewritten on every seed, so the reply is always the conversation's unfinished last turn.
    db.query('DELETE FROM agent_messages WHERE session_id=?').run(session.id)
    let parent = null
    for (const [index, row] of rows.entries()) {
      const id = `capture-unfinished-${session.id}-${index}`
      db.query(
        'INSERT INTO agent_messages(id,session_id,user_id,sequence,role,payload_json,parent_id) VALUES (?,?,?,?,?,?,?)',
      ).run(
        id,
        session.id,
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
      session.id,
    )
  } finally {
    db.close()
  }
  fixture.unfinishedReplySessionId = session.id
}

export async function composeUnfinishedReply(page) {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  if (!fixture.unfinishedReplySessionId)
    throw new Error('Run screenshots:seed for the unfinished-reply fixture.')
  await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.unfinishedReplySessionId}`)
  await openConversation(page, TITLE)
  await page.getByRole('region', { name: 'Unfinished work' }).waitFor()
}

export async function verifyUnfinishedReply(page) {
  const strip = page.getByRole('region', { name: 'Unfinished work' })
  // The decision lives above the composer: what happened, in one short line, and Continue.
  await expect(strip.getByText('Reply interrupted', { exact: true })).toBeVisible()
  await expect(
    strip.getByText('The server restarted while bash was running — check before continuing'),
  ).toBeVisible()
  await expect(strip.getByRole('button', { name: 'Continue' })).toBeVisible()
  // The transcript only marks where it stopped: a short label, no control of its own.
  const marker = page.locator('[role="status"]', { hasText: 'Reply interrupted' }).first()
  await expect(marker).toBeVisible()
  await expect(marker).toHaveAttribute('title', /this reply is incomplete/)
  await expect(marker.getByRole('button')).toHaveCount(0)
}
