import { test, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fixtureFile, uiOrigin, captureRoot, verifyDemoRuntime } from './runtime.mjs'
import { motionApi as api } from './motion-workbench.mjs'
import { openTool } from './scenarios.mjs'
import { createTemplateDocument } from '../../plugins/motion/shared/templates.ts'

test.beforeAll(verifyDemoRuntime)
test('motion/dark-films-are-seekable-and-preview-without-saving', async ({ page }) => {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const before = await api('/motion/library')
  await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
  await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
  await openTool(page, 'Motion Studio')
  await page.getByRole('button', { name: 'Create video', exact: true }).click()
  const root = path.join(captureRoot, 'motion-review/dark-films')
  await fs.mkdir(root, { recursive: true })
  for (const [id, name] of [
    ['blackout', 'Blackout'],
    ['relay', 'Relay'],
    ['nightfall', 'Nightfall'],
  ]) {
    await page.getByRole('button', { name: `Preview ${name} template`, exact: true }).click()
    const film = createTemplateDocument(id)
    const slider = page.getByRole('slider', { name: 'Video playhead', exact: true })
    const canvas = page.getByRole('img', { name: 'Motion video preview', exact: true })
    const sample = async (frame) => {
      await slider.fill(String(frame))
      // Allow the frame-driven React effect to paint before observing its pixels.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      return canvas.evaluate((node) => node.toDataURL())
    }
    const first = await sample(45)
    const initial = await sample(8)
    expect(first).not.toEqual(initial)
    await canvas.screenshot({ path: path.join(root, `${id}-entry.png`) })
    let start = 0
    for (let i = 0; i < film.scenes.length; i++) {
      await sample(Math.round((start + 1.5) * film.fps))
      await canvas.screenshot({ path: path.join(root, `${id}-scene-${i + 1}.png`) })
      start += film.scenes[i].duration
    }
    // Returning from the end samples precisely the same opening frame, without accumulating state.
    expect(await sample(45)).toEqual(first)
    await page.getByRole('button', { name: 'Back to templates', exact: true }).click()
  }
  expect((await api('/motion/library')).projects).toEqual(before.projects)
})
