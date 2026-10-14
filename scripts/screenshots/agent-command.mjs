import { expect } from '@playwright/test'
import { api, verifyDemoRuntime } from './runtime.mjs'

/** Configure the disposable composer without making a provider request. */
export async function seedAgentCommand(fixture) {
  await verifyDemoRuntime()
  const { connections } = await api('/provider-connections')
  // Isolated placeholder connection; scenarios never submit to a provider.
  const connection =
    connections.find((item) => item.label === 'Capture fixture') ??
    (await api('/provider-connections', {
      providerId: 'openai',
      providerName: 'OpenAI',
      label: 'Capture fixture',
      authType: 'api-key',
      apiKey: 'capture-placeholder-not-a-credential',
    }))
  await api(
    `/sessions/${fixture.sessionId}`,
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

export async function composeAgentCommand(page) {
  await expect(page.getByRole('heading', { name: 'Release checklist', exact: true })).toBeVisible()
  const input = page.getByRole('combobox', { name: 'Message', exact: true }).last()
  await expect(input).toBeEnabled()
  const clearCommand = page.getByRole('button', { name: 'Clear command', exact: true })
  if (await clearCommand.count()) await clearCommand.last().click()
  await input.fill('/agents edit @qa --pri')
  await expect(page.getByRole('listbox', { name: 'Command arguments' })).toHaveCount(1)
  await expect(page.getByRole('option', { name: /--priority/ })).toBeVisible()
  await input.press('Tab')
  await expect(input).toBeFocused()
  await input.fill('0.5 ')
  await expect(page.getByTitle('priority: 0.5', { exact: true })).toBeVisible()
  // The value remains exact; removing its crumb restores its value suggestions.
  await input.press('Backspace')
  await verifyAgentCommand(page)
}

export async function verifyAgentCommand(page) {
  const input = page.getByRole('combobox', { name: 'Message', exact: true }).last()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Clear action', exact: true })).toBeVisible()
  await expect(page.getByTitle('agent: @qa', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear flag:priority', exact: true })).toBeVisible()
  const menu = page.getByRole('listbox', { name: 'Command arguments' })
  await expect(menu).toHaveCount(1)
  await expect(menu.getByRole('option')).toHaveCount(5)
  for (const priority of ['-2', '-1', '0', '1', '2'])
    await expect(menu.getByText(priority, { exact: true })).toBeVisible()
}
