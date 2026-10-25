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
}

export async function verifyAgentProfile(page) {
  const detail = page.locator('[data-store-page]')
  await expect(detail.getByRole('heading', { level: 1 }).first()).toHaveText('qa')
  await expect(detail.getByText('Instructions', { exact: true }).first()).toBeVisible()
  await expect(detail.getByText('Turn limit', { exact: true }).first()).toBeVisible()
  await expect(detail.getByText('Memory', { exact: true }).first()).toBeVisible()
}
