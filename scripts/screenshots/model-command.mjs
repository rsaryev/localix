import { expect } from '@playwright/test'

// `conversations/model-command-steps`: `/model` walks the picker's own columns as composer steps.
// The seeded room has three participants, so the Agents step appears with "All agents" first; the
// capture stops on the Model step with the Agents and Provider crumbs above it. Only the isolated
// placeholder connection is listed, and nothing is sent to a provider.

const menu = (page) => page.getByRole('listbox', { name: 'Command arguments' })

export async function composeModelCommand(page) {
  await expect(page.getByRole('heading', { name: 'Release checklist', exact: true })).toBeVisible()
  const input = page.getByRole('combobox', { name: 'Message', exact: true }).last()
  await expect(input).toBeEnabled()
  const clearCommand = page.getByRole('button', { name: 'Clear command', exact: true })
  if (await clearCommand.count()) await clearCommand.last().click()
  await input.fill('/model ')
  await expect(menu(page).getByRole('option').first()).toContainText('All agents')
  // Keyboard: the second row is the first participant.
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(page.getByRole('button', { name: 'Clear agent', exact: true })).toBeVisible()
  // Mouse: the provider step lists the connections in the picker's order.
  await menu(page)
    .getByRole('option', { name: /Capture fixture/ })
    .click()
  await expect(page.getByRole('button', { name: 'Clear provider', exact: true })).toBeVisible()
  await expect(menu(page).getByRole('option').first()).toBeVisible()
}

export async function verifyModelCommand(page) {
  const input = page.getByRole('combobox', { name: 'Message', exact: true }).last()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('')
  // Breadcrumbs for the steps taken, each one a way back to its step.
  for (const crumb of ['Clear command', 'Clear agent', 'Clear provider'])
    await expect(page.getByRole('button', { name: crumb, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear model', exact: true })).toHaveCount(0)
  // The Model step: the connection's models, never a printed catalog in the transcript.
  await expect(menu(page)).toHaveCount(1)
  await expect(
    menu(page)
      .getByRole('option', { name: /gpt-4o/i })
      .first(),
  ).toBeVisible()
  await expect(page.getByText('Available models', { exact: false })).toHaveCount(0)
}
