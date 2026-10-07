import { expect } from '@playwright/test'
import { api } from './runtime.mjs'
import { button, openTool } from './scenarios.mjs'

const marketSnapshots = new WeakMap()

export async function seedPlatformViews() {
  // Live inventory comes only from the capture API's isolated KUBECONFIG.
  // Public market sources and host metrics are read-only; there is nothing to fabricate or seed.
}

export async function composePlatformViews(page, scenario) {
  if (scenario === 'system-overview') {
    await openTool(page, 'System Overview')
    await page.getByText('CPU utilization', { exact: true }).waitFor()
    await page.getByRole('textbox', { name: 'Filter processes', exact: true }).fill('bun')
    await page.getByText('CPU utilization', { exact: true }).hover()
    await page.mouse.wheel(0, -3000)
    // Allow several genuine OS samples to form the small historical charts.
    await page.waitForTimeout(10_000)
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
    await expect(page.getByRole('heading', { name: 'System overview', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'System metrics', exact: true })).toBeVisible()
    await expect(page.getByText('Native OS APIs', { exact: true })).toBeVisible()
    await expect(page.getByText('Collecting CPU history…', { exact: true })).toHaveCount(0)
    // The real filter limits any visible process rows to the capture runtime's engine.
    await expect(page.getByRole('textbox', { name: 'Filter processes', exact: true })).toHaveValue(
      'bun',
    )
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
