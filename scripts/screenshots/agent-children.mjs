import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { openConversation } from './fixture-chat.mjs'
import { api, databaseFile, fixtureFile, uiOrigin, verifyDemoRuntime } from './runtime.mjs'
import { seedTranscript, writeTranscript } from './transcript-fixture.mjs'

const TITLE = 'Agent children fixture'
const RUNNING = 'Review the release branch'
const DONE = 'Compare notes with changelog'
const MODEL_ACK =
  'agent general-purpose: started in the background. You will be notified with its reply as a message: do not poll, sleep or guess its result; keep working or end your turn.'
const REPORT =
  'Both files list the same eleven entries. The only difference is the order: the notes put Fixed before Changed.'

/**
 * Two subagent calls in one reply: a review started in the background and still going, and a
 * comparison the agent waited for. Each card names its child's status and opens its session.
 * Illustrative fixture state, written the way a run persists it: no model ran, and the first child
 * is recorded as running without a run behind it, so the capture shows the card, not a live job.
 */
async function ensureChild(db, fixture, parentId, title, runtimeStatus, taskName) {
  const sessions = await api('/sessions')
  const list = Array.isArray(sessions) ? sessions : (sessions.sessions ?? [])
  const child =
    list.find((item) => item.title === title && item.projectId === fixture.projectId) ??
    (await api('/sessions', { title, projectId: fixture.projectId }))
  db.query(
    "UPDATE agent_sessions SET parent_session_id=?, root_session_id=?, session_kind='subagent', runtime_status=?, task_name=? WHERE id=?",
  ).run(parentId, parentId, runtimeStatus, taskName, child.id)
  return child.id
}

/** Run by `seed.mjs` under Bun: the parent's transcript names the children it started. */
export async function seedAgentChildren(fixture) {
  await verifyDemoRuntime()
  const { Database } = await import('bun:sqlite')
  const { serializeMessagePayload } = await import('../../apps/api/src/db/payload-codec.ts')
  const parentId = await seedTranscript(fixture, {
    title: TITLE,
    label: 'agent children',
    idPrefix: 'capture-agent-children',
    rows: [{ role: 'user', content: 'placeholder' }],
  })
  const db = new Database(databaseFile, { strict: true })
  try {
    const running = await ensureChild(db, fixture, parentId, RUNNING, 'running', 'review_release')
    const done = await ensureChild(db, fixture, parentId, DONE, 'completed', 'compare_notes')
    const call = (id, sessionId, title, status, description, resultText, input = {}) => ({
      id,
      type: 'tool_call',
      status: 'completed',
      toolCallId: `tc-${id}`,
      name: 'Agent',
      activeVerb: 'Delegating',
      input: {
        subagent_type: 'general-purpose',
        description,
        prompt: `${description}. Report only what differs.`,
        ...input,
      },
      output: { tasks: [{ sessionId, title, status }] },
      resultText,
    })
    writeTranscript(
      db,
      parentId,
      'capture-agent-children',
      [
        {
          role: 'user',
          content: 'Review the release branch and check the notes against the changelog.',
        },
        {
          role: 'assistant',
          content: 'The review is running; the notes match the changelog.',
          items: [
            call('agent-children-running', running, RUNNING, 'running', RUNNING, MODEL_ACK),
            call('agent-children-done', done, DONE, 'completed', DONE, REPORT, {
              run_in_background: false,
            }),
            {
              type: 'text',
              id: 'agent-children-text',
              status: 'completed',
              text: 'The review is running; the notes match the changelog.',
            },
          ],
        },
      ],
      serializeMessagePayload,
    )
    // The children's own transcripts, so opening one shows a conversation.
    writeTranscript(
      db,
      done,
      'capture-agent-children-done',
      [
        { role: 'user', content: `${DONE}. Report only what differs.` },
        { role: 'assistant', content: REPORT },
      ],
      serializeMessagePayload,
    )
    fixture.agentChildrenSessionId = parentId
  } finally {
    db.close()
  }
}

export async function composeAgentChildren(page) {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  if (!fixture.agentChildrenSessionId)
    throw new Error('Run screenshots:seed for the agent-children fixture.')
  // A server restart marks every child left running as stopped, so the fixture is written again
  // just before each look, and the look repeats if a restart got in between: the first child is
  // recorded as running, the second as done.
  for (let attempt = 1; ; attempt++) {
    const seeded = spawnSync('bun', [fileURLToPath(import.meta.url)], { stdio: 'inherit' })
    if (seeded.status !== 0) throw new Error('The agent-children fixture could not be written.')
    await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.agentChildrenSessionId}`)
    await page.reload()
    await openConversation(page, TITLE)
    await page.getByRole('button', { name: /^Expand tool chain/ }).click()
    const running = page.locator('[data-slot="tool-line-subtitle"]').filter({ hasText: 'Running' })
    if (
      await running
        .first()
        .waitFor({ timeout: 8000 })
        .then(
          () => true,
          () => false,
        )
    )
      break
    if (attempt === 3) throw new Error('The running child never showed as running.')
  }
  // Open the background start the way a person reads it: its Out says what will happen.
  await page.locator('button[aria-expanded="false"]').filter({ hasText: RUNNING }).first().click()
  await page.locator('button[aria-expanded="false"]').filter({ hasText: DONE }).first().click()
  await page.getByRole('group', { name: 'Out', exact: true }).nth(1).waitFor()
}

export async function verifyAgentChildren(page) {
  const running = page.locator('[data-slot="tool-line-subtitle"]').filter({ hasText: 'Running' })
  await expect(running).toHaveCount(1)
  await expect(
    page.locator('[data-slot="tool-line-subtitle"]').filter({ hasText: 'Done' }),
  ).toHaveCount(1)
  // Each card is titled by what its child was asked; the agent type reads after the status.
  const titles = page.locator('[data-slot="tool-line-title"]')
  await expect(titles.filter({ hasText: RUNNING })).toHaveCount(1)
  await expect(titles.filter({ hasText: DONE })).toHaveCount(1)
  await expect(
    page.locator('[data-slot="tool-line-subtitle"]').filter({ hasText: 'Done · general-purpose' }),
  ).toHaveCount(1)
  // The chain reads as one sentence, never "Agent 2 agents".
  await expect(page.getByText(/^Started 2 agents/).first()).toBeVisible()
  // One control per child opens its session.
  await expect(page.getByRole('button', { name: `Open ${RUNNING}`, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: `Open ${DONE}`, exact: true })).toBeVisible()
  // The background start tells the person what happens, not the model what to do.
  const out = page.getByRole('group', { name: 'Out', exact: true }).first()
  await expect(out).toContainText('Started in the background')
  await expect(page.getByText('do not poll')).toHaveCount(0)
  // The call that waited keeps the child's own report.
  await expect(page.getByRole('group', { name: 'Out', exact: true }).nth(1)).toContainText(
    'the same eleven entries',
  )
}

/** `bun agent-children.mjs`: write the fixture again, so the first child reads as running. */
if (import.meta.main) {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  await seedAgentChildren(fixture)
  await fs.writeFile(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`)
}
