import { expect } from '@playwright/test'
import { STORE_INSTALLED } from './store-seed.mjs'

/**
 * The Store (`docs/internals/store.md`): opened from the rail's add button on its Mini apps shelf,
 * one mini app's page with what is inside it, and the Commands shelf, which lists commands rather
 * than packages. The capture runtime's catalog is the checkout's staged mini apps, three of them
 * installed through the Store by `store-seed.mjs` in a home of their own.
 */
export async function composeStore(page, scenario) {
  await page.getByRole('button', { name: 'Add mini apps', exact: true }).first().click()
  await page.locator('li[data-listing]').first().waitFor()
  if (scenario === 'store-listing') {
    // The tags sit above the card's own button: press it clear of them.
    await page
      .locator('li[data-listing="chess"] > button')
      .first()
      .click({ position: { x: 8, y: 8 } })
    await page
      .locator('[data-store-page="chess"] [aria-roledescription="carousel"] img')
      .first()
      .waitFor()
    await page.getByRole('tab', { name: 'What’s inside', exact: true }).click()
  }
  if (scenario === 'store-commands') {
    const nav = page.getByRole('navigation', { name: 'Store sections' })
    await nav.getByRole('button', { name: /^Commands/ }).click()
    await page.locator('li[data-component]').first().waitFor()
  }
}

export async function verifyStore(page, scenario) {
  const nav = page.getByRole('navigation', { name: 'Store sections' })
  await expect(nav.getByRole('button', { name: /^Installed/ })).toContainText(
    String(STORE_INSTALLED.length),
  )
  await expect(nav.getByRole('button', { name: /^Sources/ })).toBeVisible()
  // How a mini app works is not a shelf: no Screens, no Agent tools.
  await expect(nav.getByRole('button', { name: /^(Screens|Agent tools)/ })).toHaveCount(0)
  if (scenario === 'store-listing') {
    const detail = page.locator('[data-store-page="chess"]')
    await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Chess')
    await expect(detail.getByRole('img', { name: 'Verified publisher' })).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Install', exact: true })).toBeVisible()
    await expect(detail.getByRole('tabpanel')).toContainText('A screen of its own')
    return
  }
  if (scenario === 'store-commands') {
    await expect(nav.locator('[aria-current="page"]')).toContainText('Commands')
    const row = page.locator('li[data-component^="command:"]').first()
    await expect(row).toContainText('· Mini app')
    await expect(row.getByRole('button', { name: /^Install the mini app / })).toBeVisible()
    await expect(page.getByRole('switch')).toBeVisible()
    await expect(page.locator('section[aria-label="Available"]')).toHaveCount(0)
    return
  }
  await expect(nav.locator('[aria-current="page"]')).toContainText('Mini apps')
  // Featured once, in its strip; the rest grouped by what they need.
  const chess = page.locator('li[data-listing="chess"]')
  await expect(chess).toHaveCount(1)
  await expect(page.locator('section[aria-label="Featured"] li[data-listing="chess"]')).toHaveCount(
    1,
  )
  await expect(page.locator('section[aria-label="Installed"] li[data-listing]')).toHaveCount(
    STORE_INSTALLED.length,
  )
  await expect(
    page.locator('section[aria-label="Available"] li[data-listing]').first(),
  ).toBeVisible()
  // The title row is the name and its mark; what runs is on the page, not on every card.
  await expect(chess.locator('p').first()).toHaveText('Chess')
  await expect(chess).not.toContainText('Runs code')
  await expect(chess).not.toContainText('Agent tools')
  await expect(chess.getByRole('button', { name: 'Install Chess', exact: true })).toBeVisible()
  await expect(page.locator('li[data-listing] img').first()).toBeVisible()
}
