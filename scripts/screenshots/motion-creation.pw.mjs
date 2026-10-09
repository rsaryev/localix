import { test, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { motionApi as api } from './motion-workbench.mjs'
import { fixtureFile, uiOrigin, captureRoot, verifyDemoRuntime } from './runtime.mjs'
import { openTool } from './scenarios.mjs'

test.beforeAll(verifyDemoRuntime)
test('motion/closing-preview-restores-the-template-chooser', async ({ page }) => {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const before = await api('/motion/library')
  await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
  await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
  await openTool(page, 'Motion Studio')
  await page.getByRole('button', { name: 'Create video', exact: true }).click()
  await page.getByRole('button', { name: 'All directions', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Typography', exact: true }).click()
  const tile = page.getByRole('button', { name: 'Preview Type play template', exact: true })
  await tile.click()
  await page.getByRole('button', { name: 'Back to templates', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Video creation', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Typography', exact: true })).toBeVisible()
  await expect(tile).toBeFocused()
  await expect(tile).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('group', { name: 'Motion templates' }).getByRole('button'),
  ).toHaveCount(2)
  await tile.click()
  await page.keyboard.press('Escape')
  await expect(tile).toBeFocused()
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Import JSON', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Typography', exact: true })).toBeVisible()
  expect((await api('/motion/library')).projects).toHaveLength(before.projects.length)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: 'Video creation', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Motion Studio', exact: true })).toBeVisible()
})

test('motion/use-template-opens-one-saved-project', async ({ page }) => {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const before = await api('/motion/library')
  let created
  try {
    await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
    await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
    await openTool(page, 'Motion Studio')
    await page.getByRole('button', { name: 'Create video', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Video creation', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Preview Offbeat template', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Library', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Use template', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Video creation', exact: true })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Video title', exact: true })).toHaveValue(
      'Offbeat',
    )
    const after = await api('/motion/library')
    const fresh = after.projects.filter((p) => !before.projects.some((old) => old.id === p.id))
    expect(fresh).toHaveLength(1)
    created = fresh[0]
    expect(created.document.template).toBe('event')
    await page.getByRole('button', { name: 'Library', exact: true }).click()
    await page.getByRole('button', { name: /Offbeat.*Events/ }).click()
    await expect(page.getByRole('textbox', { name: 'Video title', exact: true })).toHaveValue(
      'Offbeat',
    )
    expect((await api('/motion/library')).projects).toHaveLength(after.projects.length)
  } finally {
    if (created)
      await api(`/motion/projects/${created.id}`, { revision: created.revision }, 'DELETE')
  }
})

test('motion/preview-then-create-without-side-effects', async ({ page }) => {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const before = await api('/motion/library')
  await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
  await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
  await openTool(page, 'Motion Studio')
  await page.getByRole('button', { name: 'Create video', exact: true }).click()
  await page.getByRole('button', { name: 'Preview Type play template', exact: true }).click()
  await page.getByRole('button', { name: 'Play video', exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Video playhead' })).not.toHaveValue('36')
  await page.getByRole('button', { name: 'Pause video', exact: true }).click()
  expect((await api('/motion/library')).projects).toHaveLength(before.projects.length)
  await page.getByRole('button', { name: 'Back to templates', exact: true }).click()
  await page.getByRole('button', { name: 'Start from scratch', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Video title' })).toHaveValue('Untitled video')
  const created = (await api('/motion/library')).projects.at(-1)
  try {
    expect(created.document.scenes[0].layout).toBe('custom')
    await page.getByRole('button', { name: 'Add layer', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Rosette', exact: true }).click()
    await page.getByRole('button', { name: 'Apply motion preset', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Turn', exact: true }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /^Saved · revision / })).toBeVisible()
    const saved = (await api('/motion/library')).projects.find((item) => item.id === created.id)
    expect(saved.document.scenes[0].layers[0].kind).toBe('rosette')
    expect(saved.document.scenes[0].layers[0].keyframes[0].rotation).toBe(-90)
    const stored = JSON.parse(
      await fs.readFile(path.join(fixture.root, '.localix/motion/library.json'), 'utf8'),
    )
    expect(stored.projects.find((item) => item.id === saved.id)).toEqual(saved)
  } finally {
    const current = (await api('/motion/library')).projects.find((item) => item.id === created.id)
    if (current)
      await api(`/motion/projects/${current.id}`, { revision: current.revision }, 'DELETE')
  }
})

test('motion/tools-menu-large-type-has-a-real-icon-column', async ({ page }) => {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const { api: runtimeApi } = await import('./runtime.mjs')
  const profile = await runtimeApi('/user/profile')
  await runtimeApi('/user/profile', { uiSettingsPatch: { fontSize: 'xl' } }, 'PATCH')
  try {
    await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
    await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
      .toBe('16px')
    await page.getByRole('button', { name: 'All tools', exact: true }).click()
    const rows = await page
      .locator('[role="menu"] [data-slot="menu-leading-icon"]')
      .evaluateAll((icons) =>
        icons.map((icon) => {
          const mark = icon.getBoundingClientRect()
          const label = icon.nextElementSibling.getBoundingClientRect()
          return label.left - mark.right
        }),
      )
    expect(rows.length).toBeGreaterThan(5)
    for (const gap of rows) expect(gap).toBeGreaterThanOrEqual(4)
    await page.screenshot({
      path: path.join(captureRoot, 'motion-review/tools-menu-large-type.png'),
      animations: 'disabled',
    })
  } finally {
    await runtimeApi(
      '/user/profile',
      { uiSettingsPatch: { fontSize: profile.uiSettings?.fontSize ?? null } },
      'PATCH',
    )
  }
})
