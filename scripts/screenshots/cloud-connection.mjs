import { expect } from '@playwright/test'
import { openFixtureChat } from './codemode-card.mjs'

/**
 * A cloud connection names where its requests go beside its key: picking Amazon Bedrock asks for
 * the AWS region the catalog says it needs. The form is filled with a region only; no key is
 * typed, so nothing could reach a provider, and the form proves it holds the connection back.
 */
export async function composeCloudConnection(page) {
  // A one-agent chat, whose composer opens the model browser itself (a party opens its roster).
  await openFixtureChat(page)
  await page.getByRole('button', { name: /Choose a model and connect a provider|^Model:/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Add provider', { exact: true }).waitFor()
  await dialog.getByText('Amazon Bedrock', { exact: true }).first().click()
  await dialog.getByText('Connection settings', { exact: true }).waitFor()
  await dialog.getByRole('textbox', { name: 'AWS region', exact: true }).fill('eu-west-1')
}

export async function verifyCloudConnection(page) {
  const dialog = page.getByRole('dialog')
  const region = dialog.getByRole('textbox', { name: 'AWS region', exact: true })
  await expect(region).toBeVisible()
  await expect(region).toHaveValue('eu-west-1')
  await expect(region).toHaveAttribute('placeholder', 'us-east-1')
  // The region is a setting, never a secret field; the key stays masked and empty.
  await expect(region).toHaveAttribute('type', 'text')
  await expect(dialog.locator('input[type="password"]').first()).toHaveValue('')
  // Without a key the connection cannot be added, whatever the settings say.
  await expect(dialog.getByRole('button', { name: 'Add Connection', exact: true })).toBeDisabled()
}
