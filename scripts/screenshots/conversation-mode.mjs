import { expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { api, fixtureFile, uiOrigin } from './runtime.mjs'

// `conversations/solo-mode`: what a new chat with one agent is now — the person and one agent,
// with the mode chip leading the participants strip and opening its two choices. The fixture is
// its own conversation so the seeded room stays the group the other shots depict.
const TITLE = 'Solo conversation fixture'

async function soloSession() {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const roster = await api('/sessions')
  const sessions = Array.isArray(roster) ? roster : roster.sessions
  const session =
    sessions.find((item) => item.title === TITLE) ??
    (await api('/sessions', {
      title: TITLE,
      projectId: fixture.projectId,
      agentIds: ['builtin:localix'],
      conversationMode: 'solo',
    }))
  // A reused fixture an earlier run switched is put back: the capture is of a solo chat.
  if (session.conversationMode !== 'solo')
    await api(`/sessions/${session.id}`, { conversationMode: 'solo' }, 'PATCH')
  return { fixture, session }
}

const chip = (page, mode) =>
  page.getByRole('button', { name: `Conversation mode: ${mode}. Change`, exact: true })

export async function composeConversationMode(page) {
  const { fixture, session } = await soloSession()
  await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${session.id}`)
  await chip(page, 'Solo').waitFor({ state: 'visible' })
  await chip(page, 'Solo').click()
  await page.getByRole('menu').waitFor({ state: 'visible' })
}

export async function verifyConversationMode(page) {
  const roster = page.getByRole('group', { name: 'Conversation participants', exact: true })
  // The mode leads the strip as an icon, like Add participant, before the participant it is about.
  const mode = roster.getByRole('button', { name: 'Conversation mode: Solo. Change', exact: true })
  await expect(mode.locator('.lucide-user')).toBeVisible()
  await expect(roster.locator('[data-slot="participant-chip"]')).toHaveCount(1)
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitemradio', { name: /^Solo/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(menu.getByRole('menuitemradio', { name: /^Group/ })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await expect(menu.getByText('Nobody joins by a tag and no work is handed on.')).toBeVisible()
  await expect(menu.getByText(/hand work to each other/)).toBeVisible()
  // Adding a participant stays available: it is the person's way to make the chat a group.
  await expect(page.getByRole('button', { name: 'Add participant', exact: true })).toBeVisible()
}
