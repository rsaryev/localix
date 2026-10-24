import { expect } from '@playwright/test'

/**
 * The Store (`docs/internals/store.md`): opened from the rail's add button on its Mini apps shelf,
 * and one mini app's page with what is inside it. The capture runtime's catalog is the checkout's
 * staged mini apps, so the shelf is the first-party apps, verified, with their own icons.
 */
export async function composeStore(page, scenario) {
  await page.getByRole('button', { name: 'Add mini apps', exact: true }).first().click()
  await page.locator('li[data-listing]').first().waitFor()
  if (scenario === 'store-listing') {
    await page.locator('li[data-listing="chess"] > button').first().click()
    await page
      .locator('[data-store-page="chess"] [aria-roledescription="carousel"] img')
      .first()
      .waitFor()
    await page.getByRole('tab', { name: 'What’s inside', exact: true }).click()
  }
}

export async function verifyStore(page, scenario) {
  const nav = page.getByRole('navigation', { name: 'Store sections' })
  await expect(nav.locator('[aria-current="page"]')).toContainText('Mini apps')
  await expect(nav.getByRole('button', { name: /^Installed/ })).toBeVisible()
  await expect(nav.getByRole('button', { name: /^Sources/ })).toBeVisible()
  if (scenario === 'store-listing') {
    const detail = page.locator('[data-store-page="chess"]')
    await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Chess')
    await expect(detail.getByRole('img', { name: 'Verified publisher' })).toBeVisible()
    await expect(detail.getByRole('tabpanel')).toContainText('A screen of its own')
    return
  }
  const chess = page.locator('li[data-listing="chess"]').first()
  await expect(chess).toContainText('Screen')
  await expect(chess.getByRole('button', { name: 'Chess', exact: true })).toBeVisible()
  await expect(page.locator('section li[data-listing]').first()).toBeVisible()
  await expect(page.locator('li[data-listing] img').first()).toBeVisible()
}
