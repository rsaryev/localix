import { expect } from '@playwright/test'
import { api, verifyDemoRuntime } from './runtime.mjs'

const handle = 'migration-reviewer'
const description = 'Reviews migrations for compatibility, data preservation and recovery.'

/** A real user control command; it creates no provider run and saves no incomplete definition. */
export async function seedAgentManagement(fixture) {
  await verifyDemoRuntime()
  const session = await api(`/sessions/${fixture.sessionId}`)
  if (session.projectId !== fixture.projectId)
    throw new Error('Agent capture must use its fixture project')
  if (
    session.messages.some(
      (message) =>
        message.payload.commandOutput?.command === '/agents' &&
        message.payload.content.includes(`handle=${handle}`),
    )
  )
    return
  await api(`/sessions/${fixture.sessionId}/messages`, { prompt: `/agents create ${handle}` })
}

/** The command's link opens the Agents shelf of the Store, where Add agent is. */
export async function composeAgentManagement(page) {
  await page
    .getByRole('link', { name: `Create @${handle}`, exact: true })
    .last()
    .click()
  await page.getByRole('button', { name: 'Add agent', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Name' }).first().fill(handle)
  await dialog.getByRole('textbox', { name: 'Description' }).first().fill(description)
}

export async function verifyAgentManagement(page) {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Add agent', exact: true })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Name' }).first()).toHaveValue(handle)
  await expect(dialog.getByRole('textbox', { name: 'Description' }).first()).toHaveValue(
    description,
  )
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeEnabled()
}

/** An agent's own page in the Store, reached from the `/agents list` reply, the way a person does. */
export async function seedAgentProfile(fixture) {
  await verifyDemoRuntime()
  const session = await api(`/sessions/${fixture.sessionId}`)
  if (session.projectId !== fixture.projectId)
    throw new Error('Agent capture must use its fixture project')
  if (session.messages.some((message) => message.payload.commandOutput?.command === '/agents'))
    return
  await api(`/sessions/${fixture.sessionId}/messages`, { prompt: '/agents list' })
}

export async function composeAgentProfile(page) {
  await page.getByRole('link', { name: '@qa', exact: true }).last().click()
  await page.locator('[data-store-page]').waitFor()
  await page.getByRole('tab', { name: 'Settings', exact: true }).click()
  await page.getByText('Instructions', { exact: true }).first().waitFor()
  // The page is the subject: give the Store the whole workspace, and scroll with the wheel until the
  // turn limit is whole under the instructions, model and effort.
  const maximize = page.getByRole('button', { name: 'Maximize panel', exact: true })
  if (await maximize.count()) await maximize.first().click()
  const limit = page.getByText('Turn limit', { exact: true }).first()
  await page.mouse.move(700, 600)
  for (let step = 0; step < 6; step++) {
    const box = await limit.boundingBox()
    // The label's field sits about 60px below it; keep it clear of the bottom edge.
    if (box && box.y + 120 < 1000) break
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(150)
  }
}

export async function verifyAgentProfile(page) {
  const detail = page.locator('[data-store-page]')
  await expect(detail.getByRole('heading', { level: 1 }).first()).toHaveText('qa')
  await expect(detail.getByText('Instructions', { exact: true }).first()).toBeVisible()
  const limit = detail.getByText('Turn limit', { exact: true }).first()
  await expect(limit).toBeVisible()
  // The field under the label is whole inside the window, not cut by its bottom edge.
  const field = page.getByRole('spinbutton').or(limit.locator('xpath=following::input[1]')).first()
  const box = await field.boundingBox()
  expect(box.y + box.height).toBeLessThanOrEqual(1000)
  // The chat pane's /agents listing is not what this image is about.
  await expect(page.getByText('@general-purpose').first()).toBeHidden()
  // Memory is not a setting of the agent's own: every agent in a chat shares the project's.
  await expect(detail.getByText('Memory', { exact: true })).toHaveCount(0)
}
