import { expect } from '@playwright/test'

/** Settings beside the conversation: the search, the strip of section tabs under it, the page. */
export async function composeSettingsStrip(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'Search settings', exact: true }).waitFor()
  await page.getByRole('tablist', { name: 'Settings sections', exact: true }).waitFor()
}

/** The search sits on its own row above the tabs, and the active tab is fully in view. */
export async function verifySettingsStrip(page) {
  const search = page.getByRole('combobox', { name: 'Search settings', exact: true })
  const tablist = page.getByRole('tablist', { name: 'Settings sections', exact: true })
  await expect(search).toBeVisible()
  await expect(tablist).toBeVisible()
  const field = await search.locator('xpath=..').boundingBox()
  const strip = await tablist.boundingBox()
  expect(strip.y).toBeGreaterThanOrEqual(field.y + field.height)
  const active = await tablist.getByRole('tab', { selected: true }).boundingBox()
  expect(active.x).toBeGreaterThanOrEqual(strip.x)
  expect(active.x + active.width).toBeLessThanOrEqual(strip.x + strip.width + 1)
}
