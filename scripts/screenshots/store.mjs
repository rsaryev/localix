import { expect } from '@playwright/test'
import { STORE_INSTALLED } from './store-seed.mjs'

/**
 * The Store (`docs/internals/store.md`): its Discover page, shelves, a package's page and consent
 * sheet, Sources with the add dialog, search and the Library. The capture runtime's mini app
 * catalog is the checkout's staged mini apps, three of them installed through the Store by
 * `store-seed.mjs` in a home of their own; the plugin shelves come from the default marketplaces,
 * read over the network when the runtime starts, so the assertions never name one plugin: they
 * check what any answer looks like.
 */
const sections = (page) => page.getByRole('navigation', { name: 'Store sections' })
const search = (page) => page.getByLabel('Search the Store')
const deck = (page, name) => page.locator(`section[aria-label="${name}"]`)

async function openStore(page) {
  await page.getByRole('button', { name: 'Add mini apps', exact: true }).first().click()
  await page.locator('[data-layout]').waitFor()
  await page.locator('[data-listing]').first().waitFor()
}

/** A section of the sidebar by its label: its button, or its entry in the narrow picker. */
async function goTo(page, label) {
  const name = new RegExp(`^${label}`)
  if (await sections(page).isVisible()) {
    await sections(page).getByRole('button', { name }).click()
  } else {
    await page.locator('[aria-label="Store sections"]').click()
    await page.getByRole('option', { name }).click()
  }
}

/** The Store's own heading for the section on show, in a wide, medium or narrow pane alike. */
const heading = (page) => page.locator('[data-layout] h2').first()

async function openFirstPackage(page) {
  await page.locator('[data-listing] button, [data-listing] a').first().click()
  await page.locator('[data-store-page]').waitFor()
}

const COMPOSE = {
  async store(page) {
    await openStore(page)
  },
  async 'store-discover'(page) {
    await openStore(page)
    await goTo(page, 'Discover')
    await page.locator('[aria-roledescription="carousel"]').waitFor()
  },
  async 'store-plugins'(page) {
    await openStore(page)
    await goTo(page, 'Plugins')
    await page.locator('[data-listing][data-kind="plugin"]').first().waitFor()
    // A plugin without an icon of its own is its first letters on a tile.
    await page
      .locator('[data-listing][data-kind="plugin"] [data-slot="app-tile"]')
      .first()
      .waitFor()
  },
  async 'store-listing'(page) {
    await openStore(page)
    await page
      .locator('[data-listing="chess"]')
      .first()
      .click({ position: { x: 8, y: 8 } })
    await page
      .locator('[data-store-page="chess"] [aria-roledescription="carousel"] img')
      .first()
      .waitFor()
    await page.getByRole('tab', { name: 'What’s inside', exact: true }).click()
  },
  async 'store-consent'(page) {
    await openStore(page)
    await goTo(page, 'Sources')
    // The community marketplace asks before anything it lists is installed.
    await page.locator('li[data-source]', { hasText: 'community' }).first().click()
    await page.locator('[data-listing]').first().waitFor()
    await openFirstPackage(page)
    await page.locator('[data-store-page]').getByRole('button', { name: /^Get / }).first().click()
    await page.getByRole('dialog').waitFor()
  },
  async 'store-sources'(page) {
    await openStore(page)
    await goTo(page, 'Sources')
    await page.getByRole('button', { name: /^Add source/ }).click()
    await page.getByRole('textbox', { name: 'Source address' }).fill('anthropics/skills')
    await page.getByRole('dialog').getByRole('button', { name: 'Read', exact: true }).click()
    await page.getByRole('dialog').locator('[aria-live="polite"] button').first().waitFor()
  },
  async 'store-search'(page) {
    await openStore(page)
    await search(page).fill('git')
    await deck(page, 'Packages').waitFor()
  },
  async 'store-installed'(page) {
    await openStore(page)
    await goTo(page, 'Installed')
    await page.locator('[data-install]').first().waitFor()
  },
  async 'store-commands'(page) {
    await openStore(page)
    await goTo(page, 'Commands')
    await page.locator('[data-component]').first().waitFor()
  },
}

export async function composeStore(page, scenario) {
  await COMPOSE[scenario](page)
}

const wide = (page) => page.locator('[data-layout="wide"]').count()

const VERIFY = {
  async store(page) {
    await expect(heading(page)).toHaveText('Mini apps')
    // The Store's own mini apps, the three the seed installed among them.
    await expect(page.locator('[data-listing][data-kind="mini-app"]').first()).toBeVisible()
    await expect(page.locator('[data-listing="chess"]').first()).toContainText('Chess')
    await expect(page.locator('[data-listing="chess"] img').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Get Chess', exact: true })).toBeVisible()
    await expect(
      page
        .locator('[data-listing="kanban"]')
        .first()
        .getByRole('button', { name: /^Open / }),
    ).toBeVisible()
  },
  async 'store-discover'(page) {
    const hero = page.locator('[aria-roledescription="carousel"]')
    await expect(hero.locator('[aria-roledescription="slide"]:not([hidden]) h3')).toBeVisible()
    await expect(hero.getByRole('button', { name: /^Get / }).first()).toBeVisible()
    await expect(deck(page, 'Categories')).toBeVisible()
    // Rows scroll sideways inside themselves; the page never does.
    const overflow = await page.evaluate(() => {
      const root = document.querySelector('[data-layout]')
      return root.scrollWidth - root.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
  },
  async 'store-plugins'(page) {
    await expect(heading(page)).toHaveText('Plugins')
    const tile = page.locator('[data-listing][data-kind="plugin"] [data-slot="app-tile"]').first()
    await expect(tile).toBeVisible()
    // The shelf is a window onto a long list: rows are cut to what is on screen.
    expect(await page.locator('[data-listing][data-kind="plugin"]').count()).toBeLessThan(80)
  },
  async 'store-listing'(page) {
    const detail = page.locator('[data-store-page="chess"]')
    await expect(detail.getByRole('heading', { level: 1 }).first()).toHaveText('Chess')
    await expect(detail.getByLabel(/^Verified/).first()).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Get Chess', exact: true })).toBeVisible()
    await expect(detail.getByRole('tabpanel')).toContainText('A screen of its own')
  },
  async 'store-consent'(page) {
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: /^Install / })).toBeVisible()
    await expect(sheet).toContainText('Localix does not review what this source lists')
    await expect(sheet.getByRole('button', { name: 'Install', exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  },
  async 'store-sources'(page) {
    await expect(heading(page)).toHaveText('Sources')
    await expect(page.locator('li[data-source]').first()).toBeVisible()
    await expect(page.locator('li[data-source]', { hasText: /Localix/ }).first()).toBeVisible()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('textbox', { name: 'Source address' })).toHaveValue(
      'anthropics/skills',
    )
  },
  async 'store-search'(page) {
    await expect(deck(page, 'Packages').locator('[data-listing]').first()).toBeVisible()
    await expect(
      page.getByRole('group', { name: 'Filters' }).or(page.getByLabel('Filters')),
    ).toBeVisible()
  },
  async 'store-installed'(page) {
    await expect(heading(page)).toHaveText('Installed')
    await expect(page.locator('[data-install]')).toHaveCount(STORE_INSTALLED.length, {
      timeout: 15_000,
    })
    await expect(page.getByRole('switch').first()).toBeVisible()
  },
  async 'store-commands'(page) {
    await expect(sections(page).locator('[aria-current="page"]')).toHaveAttribute(
      'aria-label',
      /^Commands/,
    )
    const row = page.locator('[data-component^="command:"]').first()
    await expect(row).toContainText('· Mini app')
  },
}

export async function verifyStore(page, scenario) {
  // A dialog hides the sidebar from the page's tree: its scenarios check the dialog instead.
  if ((await wide(page)) && (await page.getByRole('dialog').count()) === 0) {
    await expect(sections(page).getByRole('button', { name: /^Installed/ })).toContainText(
      String(STORE_INSTALLED.length),
    )
    await expect(sections(page).getByRole('button', { name: /^Sources/ })).toBeVisible()
    // How a mini app works is not a shelf: no Screens, no Agent tools.
    await expect(
      sections(page).getByRole('button', { name: /^(Screens|Agent tools)/ }),
    ).toHaveCount(0)
  }
  await VERIFY[scenario](page)
}
