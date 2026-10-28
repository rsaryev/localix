import { expect } from '@playwright/test'
import { STORE_INSTALLED, seedStore } from './store-seed.mjs'

/**
 * What the Store recommends for the work (`docs/internals/store.md`, "Recommendations"): the For
 * your work row on Discover and its See all view. They run in the Store's capture runtime started
 * offline (README, "Composer surfaces and recommendations"): its own `HOME`, three mini apps
 * installed and no marketplace read, so the catalog is Localix's own mini apps and the answer is
 * the same on every run. The assertions check what any answer looks like: never a package already
 * installed, never a third party's, no Community badge, no unreadable listing. The answer is worked
 * out in the background, so each scenario waits for the row rather than for a spinner.
 */
const deck = (page, name) => page.locator(`section[aria-label="${name}"]`)
const WORKED_OUT = { timeout: 60_000 }

async function openDiscover(page) {
  await page.getByRole('button', { name: 'Add mini apps', exact: true }).first().click()
  await page.locator('[data-layout]').waitFor()
  await page.locator('[data-listing]').first().waitFor()
  await page
    .getByRole('tablist', { name: 'Store sections' })
    .getByRole('tab', { name: /^Discover/ })
    .click()
  await deck(page, 'Start here').waitFor()
  await deck(page, 'For your work').waitFor(WORKED_OUT)
}

export async function composeRecommendations(page, scenario) {
  await seedStore()
  await openDiscover(page)
  if (scenario === 'for-your-work-all') {
    await page.getByRole('button', { name: 'See all For your work', exact: true }).click()
    await page.getByRole('heading', { name: 'For your work', exact: true }).waitFor()
    await page.locator('[data-listing]').first().waitFor()
  }
}

/**
 * None of the listings is a package the person already has, and every one is Localix's own: the
 * runtime starts with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, so no marketplace is read and
 * the answer cannot carry a third party's package, a Community badge or an unreadable listing.
 */
async function expectFirstParty(page, scope) {
  for (const id of STORE_INSTALLED)
    await expect(scope.locator(`[data-listing="${id}"]`)).toHaveCount(0)
  const listings = scope.locator('[data-listing]')
  for (let at = 0; at < (await listings.count()); at++)
    await expect(listings.nth(at)).toContainText('Localix')
  await expect(page.getByText('Community')).toHaveCount(0)
  await expect(page.getByText('Repo not found')).toHaveCount(0)
}

export async function verifyRecommendations(page, scenario) {
  if (scenario === 'for-your-work') {
    const row = deck(page, 'For your work')
    // Under Start here, with packages to get and a way into the whole ranking.
    const titles = await page
      .locator('[data-layout] section[aria-label]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
    expect(titles.indexOf('For your work')).toBe(titles.indexOf('Start here') + 1)
    expect(await row.locator('[data-listing]').count()).toBeGreaterThan(0)
    await expect(row.locator('[data-listing]').first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'See all For your work', exact: true }),
    ).toBeVisible()
    await expectFirstParty(page, row)
  } else if (scenario === 'for-your-work-all') {
    await expect(
      page.getByText('Suits your open tabs, the chat, the project and what you installed'),
    ).toBeVisible()
    const rows = page.locator('[data-listing]')
    // The whole answer, at most ten, one row each, best first.
    expect(await rows.count()).toBeGreaterThan(2)
    expect(await rows.count()).toBeLessThanOrEqual(10)
    await expectFirstParty(page, page.locator('[data-layout]'))
  }
}
