import { expect } from '@playwright/test'
import { api, verifyDemoRuntime } from './runtime.mjs'

/** Isolated placeholder connection; scenarios never submit to a provider. */
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
      apiKey: 'capture-placeholder-not-a-credential',
    }))
  const roster = await api('/sessions')
  const sessions = Array.isArray(roster) ? roster : roster.sessions
  const session =
    sessions.find((item) => item.title === 'Island composer fixture') ??
    (await api('/sessions', { title: 'Island composer fixture', agentIds: ['builtin:localix'] }))
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
}

const question = 'Which change should lead the release notes?'
const draftText = 'Check the release checklist and tell me what is still missing.'

async function clickOutside(page) {
  await page.mouse.click(4, 430)
  await expect(page.getByRole('main', { name: 'Agent island' })).toHaveAttribute(
    'data-expanded',
    'false',
  )
}

export async function composeIsland(page, scenario) {
  const expand = page.getByRole('button', { name: 'Expand agent island', exact: true })
  // Existing live HITL opens fully on arrival, without a second notification producer.
  await expect(page.getByRole('main', { name: 'Agent island' })).toHaveAttribute(
    'data-expanded',
    'true',
  )
  await page.mouse.move(4, 430)
  await page.waitForTimeout(650)
  await expect(page.getByRole('main', { name: 'Agent island' })).toHaveAttribute(
    'data-expanded',
    'true',
  )
  await clickOutside(page)
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  if (scenario === 'island-quick-chat') {
    await expand.hover()
    await expect(page.getByRole('main', { name: 'Agent island' })).toHaveAttribute(
      'data-expanded',
      'true',
    )
    await expect(page.getByRole('textbox', { name: /^Custom answer for/ })).toBeFocused()
    await page.mouse.move(4, 430)
    await expect(page.getByRole('main', { name: 'Agent island' })).toHaveAttribute(
      'data-expanded',
      'false',
    )
  }
  await expand.click()
  if (scenario !== 'island-question')
    await page.getByRole('button', { name: 'Answer later', exact: true }).click()
  if (scenario === 'island-quick-chat') {
    const draft = page.getByRole('region', { name: 'Quick chat' }).getByRole('combobox')
    await expect(draft).toBeFocused()
    await draft.fill('One\nTwo\nThree\nFour\nFive')
    await expect.poll(() => draft.evaluate((el) => el.clientHeight)).toBeGreaterThan(90)
    await draft.fill('')
    const emptyHeight = await draft.evaluate(
      (el) => el.closest('[data-agent-link-drop-target]').getBoundingClientRect().height,
    )
    await draft.fill(draftText)
    const typedHeight = await draft.evaluate(
      (el) => el.closest('[data-agent-link-drop-target]').getBoundingClientRect().height,
    )
    expect(typedHeight).toBe(emptyHeight)
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
    await page.getByRole('button', { name: /^Reply to agent:/ }).click()
    await expect(draft).toBeHidden()
    await page.getByRole('button', { name: 'Answer later', exact: true }).click()
    await expect(draft).toHaveValue(draftText)
    await expect(draft).toBeFocused()
    await page.getByRole('button', { name: 'Session history', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Island composer fixture', exact: true }).click()
    await expect(page.getByRole('main', { name: 'Agent island' })).toHaveAttribute(
      'data-expanded',
      'true',
    )
    await page.getByRole('button', { name: 'Session history', exact: true }).click()
    await expect(
      page.getByRole('menuitemradio', { name: 'Island composer fixture', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await draft.fill(draftText)
    return
  }
  if (scenario === 'island-question') {
    await expect(page.getByText(question, { exact: true })).toBeVisible()
    await clickOutside(page)
    await expect(page.getByText(question, { exact: true })).toBeHidden()
    const roster = await api('/attention')
    expect(roster.items.some((item) => item.key === 'question:capture-release-scope')).toBe(true)
    await expand.click()
    await expect(page.getByRole('textbox', { name: /^Custom answer for/ })).toBeFocused()
  }
  if (scenario === 'island-notch') {
    await page.getByRole('region', { name: 'Quick chat' }).getByRole('combobox').fill(draftText)
  }
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
    await expect(page.getByRole('region', { name: 'Queued question' })).toBeVisible()
    await expect(page.getByText(question, { exact: true })).toBeVisible()
    await expect(page.getByText('Reply to agent', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Send answer', exact: true })).toBeVisible()
    const frame = page.locator('[data-slot=hitl-frame]')
    expect(await frame.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await expect(page.getByRole('button', { name: 'Open chat', exact: true })).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Quick chat' }).getByRole('combobox'),
    ).toBeHidden()
  } else {
    await expect(page.getByRole('region', { name: 'Quick chat' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Project:/ })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Link a coding agent', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Model:/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Reply to agent:/ })).toBeVisible()
    if (scenario === 'island-quick-chat') {
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

/** Open the island route with a seeded composer and, for notch shots, a fixed host geometry. */
export async function openIsland(page, uiOrigin, notch) {
  await seedIslandComposer()
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
