import { expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { api, databaseFile, verifyDemoRuntime } from './runtime.mjs'

const placeholderKey = 'capture-placeholder-not-a-credential'
const question = 'Which change should lead the release notes?'

/**
 * Isolated placeholder connection and a conversation of its own. The key reaches only the scripted
 * provider preload (`scripted-provider.mjs`); the real fetch never sees it.
 */
export async function seedIslandRun() {
  await verifyDemoRuntime()
  const { connections } = await api('/provider-connections')
  const connection =
    connections.find((item) => item.label === 'Capture fixture') ??
    (await api('/provider-connections', {
      providerId: 'openai',
      providerName: 'OpenAI',
      label: 'Capture fixture',
      authType: 'api-key',
      apiKey: placeholderKey,
    }))
  // A reused connection can lose its key; the scripted provider recognizes only this one.
  if (!connection.keyCount)
    await api(`/provider-connections/${connection.id}/keys`, { apiKey: placeholderKey })
  const roster = await api('/sessions')
  const sessions = Array.isArray(roster) ? roster : roster.sessions
  const title = 'Island question fixture'
  const session =
    sessions.find((item) => item.title === title) ??
    (await api('/sessions', { title, agentIds: ['builtin:localix'] }))
  await api(
    `/sessions/${session.id}`,
    {
      route: {
        agentId: 'builtin:localix',
        providerConnectionId: connection.id,
        modelId: 'gpt-4o',
        reasoningEffort: 'low',
      },
    },
    'PATCH',
  )
  return session
}

const liveAsks = async () =>
  (await api('/attention')).items.filter((item) => item.kind === 'interaction')

/** Refuse to send the placeholder key unless the API process loaded the scripted provider. */
async function verifyScriptedProvider() {
  const { pid } = JSON.parse(await fs.readFile(`${databaseFile}.api-runtime.json`, 'utf8'))
  const marker = `${databaseFile}.scripted-provider/${pid}`
  if (!(await fs.stat(marker).catch(() => null)))
    throw new Error(
      'Start the capture API with the scripted provider preload (scripts/screenshots/README.md).',
    )
}

/** A genuine run in the fixture conversation that blocks on the agent's `AskUserQuestion` tool. */
async function startLiveAsk(session) {
  const asking = (items) =>
    items.some(
      (item) =>
        item.sessionId === session.id &&
        item.interaction?.request?.payload?.questions?.[0]?.question === question,
    )
  if (asking(await liveAsks())) return
  await verifyScriptedProvider()
  await api(`/sessions/${session.id}/messages`, { prompt: 'Draft the release notes.' })
  await expect.poll(async () => asking(await liveAsks()), { timeout: 20_000 }).toBe(true)
}

/** Open the island page with a run blocked on a question; the browser has no shell to measure. */
export async function openIsland(page, uiOrigin, notch) {
  await startLiveAsk(await seedIslandRun())
  if (notch)
    await page.addInitScript((geometry) => {
      // Deterministic host measurement; the UI and layout remain the production components.
      window.__TAURI__ = {
        core: {
          invoke: async (command) => (command === 'island_geometry' ? geometry : undefined),
        },
      }
    }, notch)
  await page.goto(`${uiOrigin}/#/island`)
  await expect(page.getByRole('main', { name: 'Agent island' })).toBeVisible()
}

const islandOf = (page) => page.getByRole('main', { name: 'Agent island' })

/** The request unfolds on arrival; folding it is not an answer, and a click on the notch reopens. */
export async function composeIsland(page) {
  const island = islandOf(page)
  await expect(island).toHaveAttribute('data-expanded', 'true')
  await expect(page.getByRole('group', { name: `Answers for ${question}` })).toBeVisible()
  // A click outside folds the card and leaves the light on; the run is still blocked.
  await page.mouse.click(4, 430)
  await expect(island).toHaveAttribute('data-expanded', 'false')
  await expect(island.locator('.lx-island-edge')).toHaveAttribute('data-mode', 'waiting')
  expect((await liveAsks()).length).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Show the request waiting for you' }).click()
  await expect(island).toHaveAttribute('data-expanded', 'true')
}

export async function verifyIsland(page) {
  const island = islandOf(page)
  await expect(island).toHaveAttribute('data-expanded', 'true')
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  // The same card as in the app: Skip and Send for a question, the deadline, Open chat.
  const card = page.getByRole('group', { name: `Answers for ${question}`, exact: true })
  await expect(card.getByRole('button', { name: /^Shared workspace/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Send/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /^Skip/ }).first()).toBeVisible()
  await expect(page.getByText(/^Continues without your answer in /)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open chat', exact: true })).toBeVisible()
  // No chat: no composer, no transcript, no folder or history controls.
  await expect(page.getByRole('region', { name: 'Quick chat' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Message' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Working folder', exact: true })).toHaveCount(0)
  const frame = page.locator('[data-slot=hitl-frame]')
  expect(await frame.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  const width = await island.evaluate((element) =>
    Number.parseFloat(element.style.getPropertyValue('--island-open-width')),
  )
  expect(width).toBe(580)
  expect(
    await island.evaluate((element) =>
      Number.parseFloat(element.style.getPropertyValue('--island-open-height')),
    ),
  ).toBeLessThanOrEqual(680)
}

/** The card starts below the notch band, so nothing sits behind the hardware cutout. */
export async function verifyNotchLayout(page, spec) {
  const content = await page.locator('.lx-island-content').boundingBox()
  expect(content.y).toBeGreaterThanOrEqual(spec.notch.notchHeight)
}
