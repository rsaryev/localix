import { expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { api, databaseFile, verifyDemoRuntime } from './runtime.mjs'

const placeholderKey = 'capture-placeholder-not-a-credential'

/**
 * Isolated placeholder connection. Its key reaches only the scripted provider preload
 * (`scripted-provider.mjs`); the real fetch never sees it.
 */
export async function seedIslandComposer() {
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
  const fixtures = {}
  // The composer conversation stays free of the question run, which has its own conversation.
  for (const title of ['Island question fixture', 'Island composer fixture']) {
    const session =
      sessions.find((item) => item.title === title) ??
      (await api('/sessions', { title, agentIds: ['builtin:localix'] }))
    // Learn the default through the same explicit route selection as the model picker.
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
    fixtures[title] = session
  }
  return fixtures['Island question fixture']
}

const question = 'Which change should lead the release notes?'
const draftText = 'Check the release checklist and tell me what is still missing.'

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

/** A genuine run in the fixture conversation that blocks on the agent's `ask` tool. */
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

/** Dismiss pending asks through the same interaction route the island's controls use. */
async function settleLiveAsks() {
  for (const item of await liveAsks())
    await api('/tools/interact', {
      toolCallId: item.interaction.toolCallId,
      action: 'dismiss',
    }).catch(() => {})
  await expect.poll(async () => (await liveAsks()).length, { timeout: 10_000 }).toBe(0)
}

async function clickOutside(page) {
  await page.mouse.click(4, 430)
  await expect(page.getByRole('main', { name: 'Agent island' })).toHaveAttribute(
    'data-expanded',
    'false',
  )
}

async function composeQuestion(page, expand) {
  const island = page.getByRole('main', { name: 'Agent island' })
  // A live ask opens the island fully on arrival and stays open when the pointer leaves.
  await expect(island).toHaveAttribute('data-expanded', 'true')
  await expect(page.getByRole('textbox', { name: `Custom answer for ${question}` })).toBeVisible()
  await page.mouse.move(4, 430)
  await page.waitForTimeout(650)
  await expect(island).toHaveAttribute('data-expanded', 'true')
  await clickOutside(page)
  await expect(page.getByRole('textbox', { name: /^Custom answer for/ })).toBeHidden()
  // Folding is not an answer: the run is still blocked on the same request.
  expect((await liveAsks()).some((item) => item.interaction?.toolName === 'ask')).toBe(true)
  await expand.click()
  await expect(page.getByRole('textbox', { name: /^Custom answer for/ })).toBeFocused()
}

async function composeQuickChat(page, expand) {
  const island = page.getByRole('main', { name: 'Agent island' })
  const draft = page.getByRole('region', { name: 'Quick chat' }).getByRole('combobox')
  await expand.hover()
  await expect(island).toHaveAttribute('data-expanded', 'true')
  await expect(draft).toBeFocused()
  await page.mouse.move(4, 430)
  await expect(island).toHaveAttribute('data-expanded', 'false')
  await expand.click()
  await expect(draft).toBeFocused()
  await draft.fill('One\nTwo\nThree\nFour\nFive')
  await expect.poll(() => draft.evaluate((el) => el.clientHeight)).toBeGreaterThan(90)
  await draft.fill('')
  const composerHeight = () =>
    draft.evaluate(
      (el) => el.closest('[data-agent-link-drop-target]').getBoundingClientRect().height,
    )
  const emptyHeight = await composerHeight()
  await draft.fill(draftText)
  expect(await composerHeight()).toBeCloseTo(emptyHeight, 1)
  await expect(
    page.getByRole('button', { name: 'Open full conversation', exact: true }),
  ).toHaveCount(0)
  const droppedFile = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['Release checklist'], 'checklist.txt', { type: 'text/plain' }))
    return transfer
  })
  // A drop bubbles from the shared composer to the island. It must stage exactly once.
  await draft.dispatchEvent('dragenter', { dataTransfer: droppedFile })
  await draft.dispatchEvent('drop', { dataTransfer: droppedFile })
  const remove = page.getByRole('button', { name: 'Remove attachment', exact: true })
  await expect(remove).toHaveCount(1)
  await remove.click()
  await expect(remove).toHaveCount(0)
  await droppedFile.dispose()
  await clickOutside(page)
  await expand.click()
  await expect(draft).toHaveValue(draftText)
  await expect(draft).toBeFocused()
  await page.getByRole('button', { name: 'Session history', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Island composer fixture', exact: true }).click()
  await expect(island).toHaveAttribute('data-expanded', 'true')
  await page.getByRole('button', { name: 'Session history', exact: true }).click()
  await expect(
    page.getByRole('menuitemradio', { name: 'Island composer fixture', exact: true }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await draft.fill(draftText)
}

export async function composeIsland(page, scenario) {
  const expand = page.getByRole('button', { name: 'Expand agent island', exact: true })
  if (scenario === 'island-question') return composeQuestion(page, expand)
  // Nothing waits: the island rests folded until the user reaches for it.
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  if (scenario === 'island-quick-chat') return composeQuickChat(page, expand)
  await expand.click()
  const draft = page.getByRole('region', { name: 'Quick chat' }).getByRole('combobox')
  await expect(draft).toBeFocused()
  if (scenario === 'island-notch') await draft.fill(draftText)
}

export async function verifyIsland(page, scenario) {
  const island = page.getByRole('main', { name: 'Agent island' })
  await expect(island).toHaveAttribute('data-expanded', 'true')
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await expect
    .poll(async () => (await page.locator('.lx-island-content').boundingBox()).y)
    .toBeGreaterThanOrEqual(0)
  await expect(page.getByRole('button', { name: 'Working folder', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New session', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Working folder', exact: true }).click()
  await expect(page.getByRole('menuitem').first()).toHaveText('Add folder…')
  const paths = page.locator('.lx-island-folder-menu .text-2xs')
  for (const description of await paths.all()) {
    expect(await description.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe(
      'nowrap',
    )
  }
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Session history', exact: true }).click()
  await expect(page.getByText('Recent sessions', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await island.locator('textarea:visible, input:visible').first().click()
  await page.mouse.move(4, 430)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(island).toHaveAttribute('data-expanded', 'true')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.lx-island-alert')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /Collapse agent island|Refresh agents/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Island views' })).toHaveCount(0)
  await expect(page.getByText('Tip', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Ready when you are', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Task context' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Attach file', exact: true })).toHaveCount(
    scenario === 'island-question' ? 0 : 1,
  )
  if (scenario === 'island-question') {
    // The live request is answered inline; the composer returns once the run continues.
    const card = page.getByRole('group', { name: `Answers for ${question}`, exact: true })
    await expect(card.getByRole('button', { name: /^Shared workspace/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(card.getByRole('button', { name: /^Team collaboration/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Send/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: /^Skip/ }).first()).toBeVisible()
    await expect(page.getByText('The agent asks', { exact: true })).toBeVisible()
    await expect(page.getByText(/^Continues without your answer in /)).toBeVisible()
    await expect(page.getByRole('button', { name: /^(Approve|Deny)/ })).toHaveCount(0)
    await expect(page.getByText(/needs input/)).toHaveCount(0)
    const frame = page.locator('[data-slot=hitl-frame]')
    expect(await frame.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await expect(page.getByRole('button', { name: 'Open chat', exact: true })).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Quick chat' }).getByRole('combobox'),
    ).toBeHidden()
    expect((await liveAsks()).length).toBeGreaterThan(0)
  } else {
    await expect(page.getByRole('region', { name: 'Quick chat' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /^Custom answer for/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Project:/ })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Link a coding agent', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Model:/ })).toHaveCount(0)
    if (scenario !== 'island-expanded') {
      await expect(
        page.getByRole('region', { name: 'Quick chat' }).getByRole('combobox'),
      ).toHaveValue(draftText)
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    }
    const height = await island.evaluate((element) =>
      Number.parseFloat(element.style.getPropertyValue('--island-open-height')),
    )
    expect(height).toBeLessThanOrEqual(680)
    if ((await page.getByLabel('Conversation', { exact: true }).count()) === 0)
      expect(height).toBeLessThan(340)
    // One open size: no handle to enlarge it, and the width never depends on the scenario.
    await expect(page.getByRole('button', { name: /^(Larger|Smaller) island$/ })).toHaveCount(0)
    const width = await island.evaluate((element) =>
      Number.parseFloat(element.style.getPropertyValue('--island-open-width')),
    )
    expect(width).toBe(580)
  }
}

/** Open the island: question shots start a run blocked on `ask`; the rest start with none. */
export async function openIsland(page, uiOrigin, notch, scenario) {
  const session = await seedIslandComposer()
  if (scenario === 'island-question') await startLiveAsk(session)
  else await settleLiveAsks()
  if (notch)
    await page.addInitScript((geometry) => {
      // Deterministic host measurement; the UI and layout remain the production components.
      window.__TAURI__ = {
        core: {
          invoke: async (command) => (command === 'companion_geometry' ? geometry : undefined),
        },
      }
    }, notch)
  await page.goto(`${uiOrigin}/#/companion`)
  await expect(page.getByRole('main', { name: 'Agent island' })).toBeVisible()
}

/** Toolbar controls sit inside the notch band and clear of the cutout on either side. */
export async function verifyNotchLayout(page, spec) {
  const toolbar = await page.getByLabel('Chat actions', { exact: true }).boundingBox()
  expect(toolbar.y).toBeLessThan(spec.notch.notchHeight)
  const folder = await page
    .getByRole('button', { name: 'Working folder', exact: true })
    .boundingBox()
  const history = await page
    .getByRole('button', { name: 'Session history', exact: true })
    .boundingBox()
  const middle = (page.viewportSize().width - spec.notch.notchWidth) / 2
  expect(folder.x + folder.width).toBeLessThanOrEqual(middle)
  expect(history.x).toBeGreaterThanOrEqual(middle + spec.notch.notchWidth)
}
