import { expect } from '@playwright/test'
import { api } from './runtime.mjs'
import { button, openTool } from './scenarios.mjs'

const marketSnapshots = new WeakMap()

export async function seedPlatformViews() {
  // Live inventory comes only from the capture API's isolated KUBECONFIG.
  // Public market sources are read-only; the reference app seeds its own entries when composed.
}

export async function composePlatformViews(page, scenario) {
  if (scenario === 'system-overview') {
    // The reference mini app, Daily Log, with the day a person would have logged by lunch.
    const { items } = await api('/template/entries')
    if (!items.length) {
      const at = (hour) => new Date(new Date().setHours(hour, 0, 0, 0)).toISOString()
      for (const entry of [
        { title: 'Oatmeal with berries', amount: 320, category: 'Breakfast', at: at(8) },
        { title: 'Flat white', amount: 120, category: 'Breakfast', at: at(9) },
        { title: 'Chicken salad', amount: 540, category: 'Lunch', at: at(13) },
      ])
        await api('/template/entries', entry)
    }
    await openTool(page, 'Daily Log')
    await page.getByText('Chicken salad', { exact: true }).waitFor()
  } else if (scenario === 'kubernetes') {
    const contexts = await api('/kubernetes/contexts')
    if (!JSON.stringify(contexts).includes('localix-capture'))
      throw new Error('Start the isolated localix-capture cluster and API KUBECONFIG first.')
    await openTool(page, 'DevOps')
    await button(page, 'Kubernetes').click()
    await page.getByRole('button', { name: 'Namespace', exact: true }).click()
    await page.getByRole('option', { name: 'release-studio', exact: true }).click()
    await page.getByRole('button', { name: /^release-preview.*Running/ }).dblclick()
    await page
      .getByText(/Configuration complete; ready for start up/)
      .first()
      .waitFor()
  } else if (scenario === 'trading') {
    // Enter through the real keyboard menu: pointer travel past the rail's Games
    // trigger can switch the open category before a long catalog item is clicked.
    await button(page, 'All tools').press('ArrowDown')
    await page
      .getByRole('menuitemradio', { name: /^Trading(?: Workspace)?(?:\s|$)/ })
      .press('Enter')
    const maximize = button(page, 'Maximize panel')
    if (await maximize.count()) await maximize.first().click()
    await button(page, 'Markets').click()
    await page.getByRole('combobox', { name: 'Market data source', exact: true }).click()
    await page.getByRole('option', { name: 'Kraken', exact: true }).click()
    await page.getByPlaceholder('Search markets…', { exact: true }).fill('BTC/USD')
    const candlesReady = page.waitForResponse(
      (response) => response.url().includes('/ohlcv?') && response.ok(),
      { timeout: 30_000 },
    )
    await page.getByText('BTC/USD', { exact: true }).first().dblclick()
    marketSnapshots.set(page, (await (await candlesReady).json()).candles)
    await page.locator('canvas').first().waitFor()
  } else throw new Error(`Unknown live platform scenario: ${scenario}`)
}

export async function verifyPlatformViews(page, scenario) {
  if (scenario === 'system-overview') {
    await expect(page.getByRole('heading', { name: 'Daily Log', exact: true })).toBeVisible()
    const today = page.getByRole('region', { name: 'Today', exact: true })
    await expect(today.getByText('980', { exact: true })).toBeVisible()
    await expect(today.getByText('1020 kcal left')).toBeVisible()
    // Today's bar is the week's tallest: a chart that rendered only its labels shows nothing.
    const week = page.getByRole('region', { name: 'Last 7 days', exact: true })
    const todayBar = week.locator('[title$=": 980 kcal"]')
    expect((await todayBar.boundingBox())?.height ?? 0).toBeGreaterThan(100)
    await expect(page.getByRole('button', { name: 'Remove Chicken salad' })).toBeVisible()
  } else if (scenario === 'kubernetes') {
    await expect(page.getByText(/Configuration complete; ready for start up/).first()).toBeVisible()
    await expect(page.getByText(/release-studio · k3d-localix-capture/).first()).toBeVisible()
    await expect(page.getByText('Running', { exact: true }).first()).toBeVisible()
  } else if (scenario === 'trading') {
    const candles = marketSnapshots.get(page)
    expect(candles?.length).toBeGreaterThan(50)
    expect(candles.every((candle) => candle.high >= candle.low && candle.close > 0)).toBe(true)
    await expect(page.getByText('BTC/USD', { exact: true }).first()).toBeVisible()
    await expect(page.locator('canvas').first()).toBeVisible()
    await expect(page.getByText('Loading market history', { exact: true })).toHaveCount(0)
    await expect(page.locator('[aria-busy="true"]:visible')).toHaveCount(0)
    await expect(
      page.getByText('The venue is unreachable — try again shortly.', { exact: true }),
    ).toHaveCount(0)
  } else throw new Error(`Unknown live platform scenario: ${scenario}`)
}
