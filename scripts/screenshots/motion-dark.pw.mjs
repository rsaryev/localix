import { test, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fixtureFile, uiOrigin, captureRoot, verifyDemoRuntime } from './runtime.mjs'
import { motionApi as api } from './motion-workbench.mjs'
import { openTool } from './scenarios.mjs'
import { createTemplateDocument } from '../../plugins/motion/shared/templates.ts'
import { templates } from '../../plugins/motion/shared/templates.ts'
import { templateIds } from '../../plugins/motion/shared/schema.ts'
import { framesOf } from '../../plugins/motion/shared/timing.ts'
import { createHash } from 'node:crypto'

test.beforeAll(verifyDemoRuntime)
test('motion/dark-films-are-seekable-and-preview-without-saving', async ({ page, browserName }) => {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const before = await api('/motion/library')
  await page.goto(`${uiOrigin}/#/project/${fixture.projectId}/${fixture.sessionId}`)
  await page.getByRole('button', { name: 'Add participant', exact: true }).waitFor()
  await openTool(page, 'Motion Studio')
  await page.getByRole('button', { name: 'Create video', exact: true }).click()
  const root = path.join(captureRoot, 'motion-review/dark-films')
  await fs.mkdir(root, { recursive: true })
  for (const id of templateIds.filter((id) => id !== 'blank')) {
    const name = templates[id].name
    await page.getByRole('button', { name: `Preview ${name} template`, exact: true }).click()
    await page.evaluate(() => document.fonts.ready)
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
    const returned = await sample(45)
    const hash = (value) => createHash('sha256').update(value).digest('hex')
    const delta = async (a, b) =>
      hash(a) === hash(b)
        ? { maximum: 0, mean: 0, significant: 0 }
        : page.evaluate(
            async ([a, b]) => {
              const pixels = async (url) => {
                const image = new Image()
                image.src = url
                await image.decode()
                const canvas = document.createElement('canvas')
                canvas.width = image.width
                canvas.height = image.height
                const ctx = canvas.getContext('2d')
                ctx.drawImage(image, 0, 0)
                return ctx.getImageData(0, 0, canvas.width, canvas.height).data
              }
              const [before, after] = await Promise.all([pixels(a), pixels(b)])
              let maximum = 0,
                total = 0,
                significant = 0
              for (let i = 0; i < before.length; i += 4) {
                let pixel = 0
                for (let channel = 0; channel < 4; channel++) {
                  const difference = Math.abs(before[i + channel] - after[i + channel])
                  maximum = Math.max(maximum, difference)
                  pixel = Math.max(pixel, difference)
                  total += difference
                }
                if (pixel > 1) significant++
              }
              return {
                maximum,
                mean: total / before.length,
                significant: significant / (before.length / 4),
              }
            },
            [a, b],
          )
    const samePixels = async (a, b, reason) => {
      const difference = await delta(a, b)
      // Native WebKit can change GPU antialias quantization even when redrawing the same frame:
      // observed peaks up to 6/255 in fewer than 0.02% of pixels. Bound both peak and aggregate error so
      // geometry, text or opacity drift still fails; Chromium's stricter peak remains one level.
      expect(difference.maximum, reason).toBeLessThanOrEqual(browserName === 'webkit' ? 8 : 1)
      expect(difference.mean, reason).toBeLessThanOrEqual(0.005)
      expect(difference.significant, reason).toBeLessThanOrEqual(0.0005)
    }
    await samePixels(returned, first, `${name}: returning to opening frame`)
    // Every authored film settles before the export boundary, including portrait campaigns.
    const end = framesOf(film) - 1
    await samePixels(await sample(end), await sample(end - 3), `${name}: closing hold`)
    if (id === 'social') {
      await sample(149)
      const inkAtEdges = await canvas.evaluate((node) => {
        const { width: w, height: h } = node
        const ctx = node.getContext('2d')
        let count = 0
        for (const x of [0, w - 18]) {
          const pixels = ctx.getImageData(x, Math.round(h * 0.06), 18, Math.round(h * 0.24)).data
          for (let i = 0; i < pixels.length; i += 4)
            if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) count++
        }
        return count
      })
      expect(
        inkAtEdges,
        'Daylight headline retains portrait side margins at its closest approach',
      ).toBe(0)
    }
    await page.getByRole('button', { name: 'Back to templates', exact: true }).click()
  }
  expect((await api('/motion/library')).projects).toEqual(before.projects)
})
