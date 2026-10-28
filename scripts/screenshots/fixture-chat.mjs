import { promises as fs } from 'node:fs'
import { expect } from '@playwright/test'
import { fixtureFile, uiOrigin } from './runtime.mjs'
import { seedTranscript } from './transcript-fixture.mjs'

const TITLE = 'Fixture chat'

/** Run by `seed.mjs` under Bun: a one-agent chat with one finished exchange. */
export async function seedFixtureChat(fixture) {
  fixture.fixtureChatSessionId = await seedTranscript(fixture, {
    title: TITLE,
    label: 'fixture chat',
    idPrefix: 'capture-fixture-chat',
    rows: [
      { role: 'user', content: 'Which release files changed?' },
      {
        role: 'assistant',
        content: '`CHANGELOG.md` and `package.json` changed for the release.',
        items: [
          {
            type: 'text',
            id: 'fixture-chat-text',
            status: 'completed',
            text: '`CHANGELOG.md` and `package.json` changed for the release.',
          },
        ],
      },
    ],
  })
}

/** Open a conversation from the history, where a fresh layout keeps it collapsed. */
export async function openConversation(page, title) {
  const composer = page.getByRole('combobox', { name: 'Message', exact: true }).last()
  if (await composer.isVisible()) return
  const history = page.getByRole('region', { name: 'Session history', exact: true })
  if (!(await history.isVisible()))
    await page.getByRole('button', { name: 'Chat history', exact: true }).click()
  // A keyboard activation: the collapsed workspace's tips overlay the history rows' pointer area.
  const row = history.getByRole('button', { name: title, exact: true })
  await row.focus()
  await row.press('Enter')
  await expect(composer).toBeVisible()
}

/** The fixture's one-agent chat, open with its composer showing. */
export async function openFixtureChat(page) {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  if (!fixture.fixtureChatSessionId) throw new Error('Run screenshots:seed for the fixture chat.')
  await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.fixtureChatSessionId}`)
  await openConversation(page, TITLE)
}
