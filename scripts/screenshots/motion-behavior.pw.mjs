import { test, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import { createTemplateDocument } from '../../plugins/motion/shared/templates.ts'
import { fixtureFile, uiOrigin, verifyDemoRuntime } from './runtime.mjs'
import { motionApi as api } from './motion-workbench.mjs'
import { openTool } from './scenarios.mjs'

test.beforeAll(verifyDemoRuntime)
test('motion/editor-saves-and-preserves-concurrent-drafts', async ({ page }) => {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const document = createTemplateDocument('launch', 'Editing evidence')
  const state = await api('/motion/projects', {
    template: 'launch',
    title: document.title,
    document,
  })
  const project = state.projects.at(-1)
  try {
    await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
    await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
    await openTool(page, 'Motion Studio')
    await page.getByRole('button', { name: /Editing evidence.*Product/ }).click()
    const headline = page.getByRole('textbox', { name: 'Headline', exact: true })
    await headline.fill('The user’s saved story.')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    let saved = (await api('/motion/library')).projects.find((item) => item.id === project.id)
    expect(saved.document.scenes[0].headline).toBe('The user’s saved story.')
    await headline.fill('Keep this unsaved draft.')
    const changed = structuredClone(saved.document)
    changed.scenes[0].headline = 'The agent’s new story.'
    await api(
      `/motion/projects/${project.id}`,
      { revision: saved.revision, document: changed },
      'PUT',
    )
    // A healthy pushed store feed beats its 3-second fallback poll.
    await expect(page.getByText(/The agent changed this video/)).toBeVisible({ timeout: 2000 })
    await expect(headline).toHaveValue('Keep this unsaved draft.')
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Library', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(headline).toHaveValue('Keep this unsaved draft.')
    await page.getByRole('button', { name: 'Discard draft', exact: true }).click()
    await expect(headline).toHaveValue('The agent’s new story.')
    await page.getByRole('button', { name: 'Duplicate scene', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Video scenes' }).getByRole('button')).toHaveCount(
      5,
    )
    await page.getByRole('button', { name: 'Move scene later', exact: true }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    saved = (await api('/motion/library')).projects.find((item) => item.id === project.id)
    expect(saved.document.scenes).toHaveLength(5)
    expect(new Set(saved.document.scenes.map((scene) => scene.id)).size).toBe(5)
    await page.getByRole('button', { name: /^ADVANCED MOTION/i }).click()
    await page.getByRole('button', { name: 'Add layer', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Text', exact: true }).click()
    await page.getByRole('textbox', { name: 'Layer text', exact: true }).fill('Layer evidence')
    await page.getByRole('spinbutton', { name: 'Position X (%)', exact: true }).fill('65')
    await page.getByRole('textbox', { name: 'Layer text', exact: true }).focus()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    saved = (await api('/motion/library')).projects.find((item) => item.id === project.id)
    const layer = saved.document.scenes
      .flatMap((scene) => scene.layers)
      .find((layer) => layer.text === 'Layer evidence')
    expect(layer).toBeDefined()
    expect(layer.keyframes[1].x).toBe(0.65)
  } finally {
    const current = (await api('/motion/library')).projects.find((item) => item.id === project.id)
    if (current)
      await api(`/motion/projects/${project.id}`, { revision: current.revision }, 'DELETE')
  }
})
