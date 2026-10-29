import { expect } from '@playwright/test'
import {
  STALE_SKILL,
  STORE_INSTALL_COUNT,
  installedMiniApps,
  showcaseMiniApp,
} from './store-seed.mjs'

/**
 * The Store (`docs/internals/store.md`): its Discover page, shelves, a package's page and consent
 * sheet, Sources with the add dialog, search and the Library. The mini app catalog and the plugin
 * shelves come from the default sources, read over the network when the runtime starts, and three
 * mini apps are installed through the Store by `store-seed.mjs` in a home of their own. The
 * assertions never name a package: they use the ones the seed picked and check what any answer
 * looks like.
 */
const sections = (page) => page.getByRole('tablist', { name: 'Store sections' })
const search = (page) => page.getByLabel('Search the Store')
const deck = (page, name) => page.locator(`section[aria-label="${name}"]`)

async function openStore(page) {
  await page.getByRole('button', { name: 'Add mini apps', exact: true }).first().click()
  await page.locator('[data-layout]').waitFor()
  await page.locator('[data-listing]').first().waitFor()
}

const library = (page) => page.getByRole('navigation', { name: 'Your library' })

/** A section by its tab, its library button, or its entry under More. */
async function goTo(page, label) {
  const tab = sections(page).getByRole('tab', { name: new RegExp(`^${label}`) })
  if (await tab.count()) return tab.click()
  const shelf = library(page).getByRole('button', { name: new RegExp(`^${label}`) })
  if (await shelf.count()) return shelf.click()
  await page.getByRole('button', { name: /^More sections/ }).click()
  await page.getByRole('menuitemradio', { name: label }).click()
}

/** The Store's own heading for the section on show, in a wide, medium or narrow pane alike. */
const heading = (page) => page.locator('[data-layout] h2').first()

async function openFirstPackage(page) {
  await page.locator('[data-listing] button, [data-listing] a').first().click()
  await page.locator('[data-store-page]').waitFor()
}

const COMPOSE = {
  async store(page) {
    // The Store opens on Discover; the Mini apps shelf is a tab away.
    await openStore(page)
    await goTo(page, 'Mini apps')
  },
  async 'store-discover'(page) {
    await openStore(page)
    await goTo(page, 'Discover')
    await deck(page, 'Start here').waitFor()
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
    const id = await showcaseMiniApp()
    await openStore(page)
    await goTo(page, 'Mini apps')
    await page
      .locator(`[data-listing="${id}"]`)
      .first()
      .click({ position: { x: 8, y: 8 } })
    await page
      .locator(`[data-store-page="${id}"] [aria-roledescription="carousel"] img`)
      .first()
      .waitFor()
    await page.getByRole('tab', { name: 'What’s inside', exact: true }).click()
    // Its parts in groups of one kind, each under its label and count.
    await page.locator(`[data-store-page="${id}"] [role="tabpanel"] section > h3`).first().waitFor()
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
  async 'store-search-wide'(page) {
    await openStore(page)
    // The Store alone in the window: the chat it opened beside is closed.
    const chat = page.getByRole('tab', { name: /New Chat/ })
    await chat.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Close', exact: true }).click()
    await chat.waitFor({ state: 'detached' })
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
  async 'store-yours'(page) {
    await openStore(page)
    await goTo(page, 'Yours')
    await page.locator('[data-listing="docs-search"]').first().waitFor()
  },
  async 'store-archive-unused'(page) {
    await openStore(page)
    await goTo(page, 'Yours')
    await page.getByRole('button', { name: 'Archive unused', exact: true }).click()
    await page.getByRole('dialog').getByText(STALE_SKILL).waitFor()
  },
  async 'store-mcp-settings'(page) {
    await openStore(page)
    await goTo(page, 'Yours')
    await page
      .locator('[data-listing="docs-search"]')
      .first()
      .click({ position: { x: 8, y: 8 } })
    await page.locator('[data-store-page="docs-search"]').waitFor()
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Test connection', exact: true }).waitFor()
  },
}

export async function composeStore(page, scenario) {
  await COMPOSE[scenario](page)
}

const VERIFY = {
  async store(page) {
    await expect(heading(page)).toHaveText('Mini apps')
    // The catalog's mini apps, the three the seed installed among them.
    const tiles = page.locator('[data-listing][data-kind="mini-app"]')
    await expect(tiles.first()).toBeVisible()
    await expect(tiles.getByRole('button', { name: /^Get / }).first()).toBeVisible()
    for (const id of await installedMiniApps())
      await expect(
        page
          .locator(`[data-listing="${id}"]`)
          .first()
          .getByRole('button', { name: /^Open / }),
      ).toBeVisible()
  },
  async 'store-discover'(page) {
    // No carousel above the rows: Start here leads, with packages a person can get.
    await expect(page.locator('[aria-roledescription="carousel"]')).toHaveCount(0)
    await expect(deck(page, 'Start here').locator('[data-listing]').first()).toBeVisible()
    await expect(deck(page, 'Categories')).toBeVisible()
    // Rows scroll sideways inside themselves; the page never does.
    const overflow = await page.evaluate(() => {
      const root = document.querySelector('[data-layout]')
      return root.scrollWidth - root.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
    // Tiles are one even row each: the same height, the action on the name's row, and no
    // category cut short while there is room for it.
    const shape = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-store-scroller] section [data-listing]')]
      const heights = new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().height)))
      const apart = tiles.filter((tile) => {
        const name = tile.querySelector('p')?.getBoundingClientRect()
        const action = tile.querySelector('.pointer-events-auto')
        const box = action?.getBoundingClientRect()
        return !name || !box || box.top > name.bottom
      }).length
      const cut = [
        ...document.querySelectorAll('section[aria-label="Categories"] button span.truncate'),
      ].filter((label) => label.scrollWidth > label.clientWidth).length
      return { tiles: tiles.length, heights: heights.size, apart, cut }
    })
    expect(shape.tiles).toBeGreaterThan(0)
    expect(shape.heights).toBe(1)
    expect(shape.apart).toBe(0)
    expect(shape.cut).toBe(0)
  },
  async 'store-plugins'(page) {
    await expect(heading(page)).toHaveText('Plugins')
    const tile = page.locator('[data-listing][data-kind="plugin"] [data-slot="app-tile"]').first()
    await expect(tile).toBeVisible()
    // The shelf is a window onto a long list: rows are cut to what is on screen.
    expect(await page.locator('[data-listing][data-kind="plugin"]').count()).toBeLessThan(80)
  },
  async 'store-listing'(page) {
    const detail = page.locator('[data-store-page]')
    await expect(detail.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await expect(detail.getByLabel(/^Verified/).first()).toBeVisible()
    // The package's one action sits in its header, under the name; the seed may have installed it.
    await expect(
      detail.locator('header').getByRole('button', { name: /^(?:Get|Open) / }),
    ).toBeVisible()
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
  async 'store-search-wide'(page) {
    await VERIFY['store-search'](page)
    await expect(page.getByRole('tab', { name: /New Chat/ })).toHaveCount(0)
  },
  async 'store-installed'(page) {
    await expect(heading(page)).toHaveText('Installed')
    // The three mini apps the seed installed are there, beside the agents that come with Localix.
    const installed = await installedMiniApps()
    expect(installed).toHaveLength(STORE_INSTALL_COUNT)
    for (const id of installed)
      await expect(page.locator(`[data-install="${id}"]`)).toHaveCount(1, { timeout: 15_000 })
    await expect(page.getByRole('switch').first()).toBeVisible()
  },
  async 'store-commands'(page) {
    await expect(page.getByRole('button', { name: 'More sections: Commands' })).toBeVisible()
    const row = page.locator('[data-component^="command:"]').first()
    await expect(row).toContainText(/In .+ · (Mini app|Plugin)/)
  },
  async 'store-yours'(page) {
    await expect(heading(page)).toHaveText('Yours')
    await expect(page.locator('[data-listing="user:release-notes"]').first()).toContainText(
      'release-notes',
    )
    await expect(page.locator('[data-listing="docs-search"]').first()).toContainText('docs-search')
    await expect(page.getByRole('button', { name: 'Add skill', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add MCP server', exact: true })).toBeVisible()
  },
  async 'store-archive-unused'(page) {
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Archive unused' })).toBeVisible()
    // The stale skill is listed with why; the one written moments ago is not.
    await expect(sheet.getByRole('listitem').filter({ hasText: STALE_SKILL })).toContainText(
      'Never used, 60 days old',
    )
    await expect(sheet).not.toContainText('release-notes')
    await expect(sheet.getByRole('button', { name: 'Archive unused', exact: true })).toBeEnabled()
    await expect(sheet.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  },
  async 'store-mcp-settings'(page) {
    const detail = page.locator('[data-store-page="docs-search"]')
    await expect(detail.getByRole('heading', { level: 1 }).first()).toHaveText('docs-search')
    await expect(detail.getByText('Listen as a channel')).toBeVisible()
    // A header is a secret: the page says it is set and never shows it.
    await expect(detail.getByText('Set').first()).toBeVisible()
    await expect(detail).not.toContainText('demo-token')
    await expect(detail.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  },
}

export async function verifyStore(page, scenario) {
  // A dialog hides the tabs from the page's tree: its scenarios check the dialog instead.
  if ((await page.getByRole('dialog').count()) === 0) {
    // The library beside the search; only Updates carries a count.
    await expect(library(page).getByRole('button', { name: /^Installed/ })).toHaveText('Installed')
    await expect(library(page).getByRole('button', { name: /^Sources/ })).toBeVisible()
    // Skills, Agents and MCP servers are one shelf each, never a second list of packages.
    for (const name of ['Skills', 'Agents', 'MCP servers'])
      expect(
        await sections(page)
          .getByRole('tab', { name: new RegExp(`^${name}`) })
          .count(),
      ).toBeLessThanOrEqual(1)
    // How a mini app works is not a shelf: no Screens, no Agent tools.
    await expect(sections(page).getByRole('tab', { name: /^(Screens|Agent tools)/ })).toHaveCount(0)
    // The page is never a column beside a section sidebar.
    await expect(page.getByRole('navigation', { name: 'Store sections' })).toHaveCount(0)
  }
  await VERIFY[scenario](page)
}
