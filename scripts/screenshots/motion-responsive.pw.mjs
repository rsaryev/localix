import { test, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { composeMotion, verifyMotion } from './motion-workbench.mjs'
import { fixtureFile, uiOrigin, captureRoot, verifyDemoRuntime } from './runtime.mjs'
import { templateIds } from '../../plugins/motion/shared/schema.ts'

test.beforeAll(verifyDemoRuntime)
for (const [name, width, theme] of [
  ['wide-light', 1600, 'light'],
  ['narrow-dark', 560, 'dark'],
]) {
  test(`motion/responsive-${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    // Exercise the real persistent theme preference, not screenshot recoloring.
    await page.addInitScript((theme) => localStorage.setItem('sandbox_theme', theme), theme)
    const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
    await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
    await composeMotion(page, 'motion-editor')
    await page.setViewportSize({ width, height: 1000 })
    await verifyMotion(page, 'motion-editor')
    const overflowing = await page
      .getByRole('heading', { name: 'Motion Studio', exact: true })
      .evaluate((heading) => {
        const pane = heading.closest('.\\@container')
        return { scroll: pane.scrollWidth, client: pane.clientWidth }
      })
    expect(overflowing.scroll).toBeLessThanOrEqual(overflowing.client + 1)
    if (width < 600) expect(overflowing.client).toBeLessThan(600)
    await expect(page.getByRole('button', { name: 'Export video', exact: true })).toBeVisible()
    expect(errors).toEqual([])
    await page.evaluate(() => document.fonts.ready)
    const root = path.join(captureRoot, 'motion-review')
    await fs.mkdir(root, { recursive: true })
    await page.screenshot({ path: path.join(root, `${name}.png`), animations: 'disabled' })
  })
  test(`motion/chooser-responsive-${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.addInitScript((theme) => localStorage.setItem('sandbox_theme', theme), theme)
    const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
    await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
    await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
    await composeMotion(page, 'motion-template-preview')
    await page.setViewportSize({ width, height: 1000 })
    await verifyMotion(page, 'motion-template-preview')
    const creation = page.getByRole('region', { name: 'Video creation', exact: true })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const bounds = await creation.evaluate((node) => ({
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      scroll: node.scrollWidth,
      client: node.clientWidth,
    }))
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width)
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1)
    const root = path.join(captureRoot, 'motion-review')
    await fs.mkdir(root, { recursive: true })
    await page.getByRole('button', { name: 'Back to templates', exact: true }).click()
    const tile = page.getByRole('button', { name: 'Preview Offbeat template', exact: true })
    await expect(tile).toBeFocused()
    await expect(tile).toHaveAttribute('aria-pressed', 'true')
    const visible = await tile.evaluate((node) => {
      const tile = node.getBoundingClientRect()
      const body = node.closest('[data-slot="motion-creation-body"]').getBoundingClientRect()
      return tile.top >= body.top - 1 && tile.bottom <= body.bottom + 1
    })
    expect(visible).toBe(true)
    await page.getByRole('button', { name: 'All directions', exact: true }).focus()
    await expect(creation.getByRole('heading', { name: 'Create video', exact: true })).toBeVisible()
    await expect(
      page.getByRole('group', { name: 'Motion templates' }).getByRole('button'),
    ).toHaveCount(templateIds.length - 1)
    const columns = await page
      .getByRole('group', { name: 'Motion templates' })
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
    expect(columns).toBe(width < 600 ? 2 : 6)
    if (width >= 1000) {
      const last = page.getByRole('button', { name: 'Preview Field notes template', exact: true })
      const withinBody = await last.evaluate(
        (node) =>
          node.getBoundingClientRect().bottom <=
          node.closest('[data-slot="motion-creation-body"]').getBoundingClientRect().bottom,
      )
      expect(withinBody).toBe(true)
    }
    await expect(
      page.getByRole('button', { name: 'Start from scratch', exact: true }),
    ).toBeVisible()
    await page.screenshot({ path: path.join(root, `chooser-${name}.png`), animations: 'disabled' })
  })
}
