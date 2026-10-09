import { test, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { motionApi as api } from './motion-workbench.mjs'
import { fixtureFile, uiOrigin, verifyDemoRuntime } from './runtime.mjs'
import { openTool } from './scenarios.mjs'
import { createTemplateDocument, templates } from '../../plugins/motion/shared/templates.ts'

test.beforeAll(verifyDemoRuntime)
test('motion/relay-camera-survives-retiming-and-reopening', async ({ page }) => {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const before = await api('/motion/library')
  let id
  try {
    await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
    await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
    await openTool(page, 'Motion Studio')
    await page.getByRole('button', { name: 'Create video', exact: true }).click()
    await page.getByRole('button', { name: 'Preview Relay template', exact: true }).click()
    await page.getByRole('button', { name: 'Use template', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Video title', exact: true })).toHaveValue(
      'Relay',
    )
    const fresh = (await api('/motion/library')).projects.filter(
      (project) => !before.projects.some((old) => old.id === project.id),
    )
    expect(fresh).toHaveLength(1)
    id = fresh[0].id
    expect(fresh[0].document.scenes[0].camera.frames).toHaveLength(8)
    const duration = page.getByRole('spinbutton', { name: 'Duration (seconds)', exact: true })
    await duration.fill('6')
    await duration.press('Tab')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /^Saved · revision / })).toBeVisible()
    const saved = (await api('/motion/library')).projects.find((project) => project.id === id)
    expect(saved.document.scenes[0].duration).toBe(6)
    expect(saved.document.scenes[0].camera.frames.at(-1).time).toBeCloseTo(6 * 0.94)
    await page.getByRole('button', { name: 'Library', exact: true }).click()
    await page.getByRole('button', { name: /Relay.*Product/ }).click()
    await expect(duration).toHaveValue('6')
    await expect(page.getByRole('img', { name: 'Motion video preview', exact: true })).toBeVisible()
  } finally {
    if (id) {
      const current = (await api('/motion/library')).projects.find((project) => project.id === id)
      if (current) await api(`/motion/projects/${id}`, { revision: current.revision }, 'DELETE')
    }
  }
})

test('motion/spatial-fields-edit-and-save-the-visible-composition', async ({ page }) => {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
  await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
  await openTool(page, 'Motion Studio')
  for (const template of ['report', 'explainer', 'editorial', 'kinetic']) {
    const document = createTemplateDocument(template, `Editable ${template}`)
    const created = await api('/motion/projects', { template, title: document.title, document })
    const id = created.projects.at(-1).id
    try {
      await page
        .getByRole('button', {
          name: new RegExp(`^Editable ${template}.*${templates[template].category}`),
        })
        .click()
      const playhead = page.getByRole('slider', { name: 'Video playhead', exact: true })
      await playhead.fill(template === 'report' ? '180' : '60')
      const preview = page.getByRole('img', { name: 'Motion video preview', exact: true })
      const pixels = async () => {
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
        return preview.evaluate((node) => node.toDataURL())
      }
      const before = await pixels()
      if (template === 'report') {
        const value = page.getByRole('spinbutton', { name: 'Bar 4 value', exact: true })
        await value.fill('0')
        await value.press('Tab')
      } else if (template === 'explainer') {
        await page
          .getByRole('textbox', { name: 'Items', exact: true })
          .fill('First\nSecond\nThird\nFourth\nFifth\nSixth')
      } else if (template === 'editorial') {
        await expect(
          page.getByRole('button', { name: 'Image: illustrative composition', exact: true }),
        ).toBeVisible()
        await page
          .getByRole('textbox', { name: 'Headline', exact: true })
          .fill('A new\nperspective.')
      } else {
        await page.getByRole('button', { name: 'Typeface: sans', exact: true }).click()
        await page.getByRole('menuitemradio', { name: 'Serif', exact: true }).click()
      }
      expect(await pixels()).not.toEqual(before)
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: /^Saved · revision / })).toBeVisible()
      const saved = (await api('/motion/library')).projects.find(
        (project) => project.id === id,
      ).document
      if (template === 'report') expect(saved.scenes[1].series[3].value).toBe(0)
      if (template === 'explainer') expect(saved.scenes[0].items).toHaveLength(6)
      if (template === 'editorial') expect(saved.scenes[0].headline).toBe('A new\nperspective.')
      if (template === 'kinetic') expect(saved.scenes[0].typeface).toBe('serif')
      await page.getByRole('button', { name: 'Library', exact: true }).click()
    } finally {
      const current = (await api('/motion/library')).projects.find((project) => project.id === id)
      if (current) await api(`/motion/projects/${id}`, { revision: current.revision }, 'DELETE')
    }
  }
})
