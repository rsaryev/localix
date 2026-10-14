import { expect } from '@playwright/test'
import { api, verifyDemoRuntime } from './runtime.mjs'

const handle = 'migration-reviewer'
const description = 'Reviews migrations for compatibility, data preservation and recovery.'
const instructions =
  'Review schema and data migrations. Explain compatibility risks, identify data-loss cases and check recovery. Return findings with evidence.'

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

export async function composeAgentManagement(page) {
  await page
    .getByRole('link', { name: `Create @${handle}`, exact: true })
    .last()
    .click()
  await expect(page.getByRole('textbox', { name: 'Name Required', exact: true })).toHaveValue(
    handle,
  )
  await page.getByRole('textbox', { name: 'Description Optional', exact: true }).fill(description)
  await page
    .getByRole('textbox', { name: 'Standing instructions Required', exact: true })
    .fill(instructions)
  await page
    .getByRole('textbox', { name: 'Title Optional', exact: true })
    .fill('Migration Reviewer')
  const priority = page.getByRole('spinbutton', {
    name: 'Hierarchy priority Required',
    exact: true,
  })
  await expect(priority).toHaveAttribute('required', '')
  await priority.fill('0')
  await page.getByRole('textbox', { name: 'Name Required', exact: true }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Create agent', exact: true }).scrollIntoViewIfNeeded()
}

export async function verifyAgentManagement(page) {
  await expect(
    page.getByRole('link', { name: `Create @${handle}`, exact: true }).last(),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Name Required', exact: true })).toHaveValue(
    handle,
  )
  await expect(
    page.getByRole('textbox', { name: 'Description Optional', exact: true }),
  ).toHaveValue(description)
  await expect(
    page.getByRole('textbox', { name: 'Standing instructions Required', exact: true }),
  ).toHaveValue(instructions)
  await expect(page.getByRole('button', { name: 'Create agent', exact: true })).toBeEnabled()
  await expect(
    page.getByRole('spinbutton', { name: 'Hierarchy priority Required', exact: true }),
  ).toHaveValue('0')
}
