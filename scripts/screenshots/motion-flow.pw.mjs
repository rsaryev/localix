import { test, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { motionApi as api } from './motion-workbench.mjs'
import { fixtureFile, uiOrigin, verifyDemoRuntime } from './runtime.mjs'
import { openTool } from './scenarios.mjs'

test.beforeAll(verifyDemoRuntime)
test('motion/use-direction-forks-one-film-and-opens-it', async ({ page }) => {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  for (const project of (await api('/motion/library')).projects)
    await api(`/motion/projects/${project.id}`, {}, 'DELETE')
  await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
  await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
  await openTool(page, 'Motion Studio')
  await page.getByRole('button', { name: 'New film', exact: true }).click()
  await page.getByRole('button', { name: 'Field notes direction', exact: true }).click()
  await page.getByRole('button', { name: 'Back to directions', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Choose a direction', exact: true })).toBeVisible()
  expect((await api('/motion/library')).projects).toHaveLength(0)
  await page.getByRole('button', { name: 'Field notes direction', exact: true }).click()
  await page.getByRole('button', { name: 'Use direction', exact: true }).click()
  try {
    await expect(page.getByRole('heading', { name: 'Field notes', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Preview of Field notes' })).toBeVisible()
    const library = await api('/motion/library')
    expect(library.projects.map((project) => [project.id, project.style])).toEqual([
      ['field-notes', 'field-notes'],
    ])
    await page.getByRole('button', { name: 'Back to films', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Films' }).getByText('Field notes')).toBeVisible()
  } finally {
    for (const project of (await api('/motion/library')).projects)
      await api(`/motion/projects/${project.id}`, {}, 'DELETE')
  }
})
