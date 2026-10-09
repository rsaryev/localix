import { expect } from '@playwright/test'
import { createTemplateDocument } from '../../plugins/motion/shared/templates.ts'
import { templateIds } from '../../plugins/motion/shared/schema.ts'
import { promises as fs } from 'node:fs'
import { api as runtimeApi, fixtureFile } from './runtime.mjs'

export async function motionApi(path, body, method) {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  return runtimeApi(
    `${path}?${new URLSearchParams({ sessionId: fixture.sessionId })}`,
    body,
    method,
  )
}
const api = motionApi
import { openTool } from './scenarios.mjs'

export async function seedMotion() {
  const title = 'Motion study — demo'
  const state = await api('/motion/library')
  const existing = state.projects.find((project) => project.document.title === title)
  const document = createTemplateDocument('launch', title)
  document.scenes.forEach((scene, index) => {
    scene.id = `b267c268-955e-48fc-8d6f-${String(index + 1).padStart(12, '0')}`
  })
  document.scenes[0].headline = 'Ideas,\nin motion.'
  document.scenes[0].label = 'Illustrative motion study'
  document.brief = 'A fictional product story showing a hook, reveal, benefits and end card.'
  if (existing)
    return api(`/motion/projects/${existing.id}`, { revision: existing.revision, document }, 'PUT')
  return api('/motion/projects', { template: 'launch', title, document })
}
export async function composeMotion(page, scenario) {
  await seedMotion()
  if (scenario === 'motion-empty') {
    const state = await api('/motion/library')
    if (state.projects.length !== 1 || state.projects[0].document.title !== 'Motion study — demo')
      throw new Error('Empty capture requires only its owned demo project.')
    await api(
      `/motion/projects/${state.projects[0].id}`,
      { revision: state.projects[0].revision },
      'DELETE',
    )
  }
  await openTool(page, 'Motion Studio')
  await expect(page.getByRole('heading', { name: 'Motion Studio', exact: true })).toBeVisible()
  if (
    [
      'motion-library',
      'motion-template-preview',
      'motion-template-return',
      'motion-dark-hook',
      'motion-product-reveal',
      'motion-gather-preview',
      'motion-portfolio-preview',
    ].includes(scenario)
  )
    await page.getByRole('button', { name: 'Create video', exact: true }).click()
  if (scenario === 'motion-template-return') {
    await page.getByRole('button', { name: 'All directions', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Typography', exact: true }).click()
    await page.getByRole('button', { name: 'Preview Type play template', exact: true }).click()
    await page.getByRole('button', { name: 'Back to templates', exact: true }).click()
  }
  if (scenario === 'motion-template-preview')
    await page.getByRole('button', { name: 'Preview Offbeat template', exact: true }).click()
  if (
    [
      'motion-dark-hook',
      'motion-product-reveal',
      'motion-gather-preview',
      'motion-portfolio-preview',
    ].includes(scenario)
  ) {
    const name = {
      'motion-dark-hook': 'Blackout',
      'motion-product-reveal': 'Relay',
      'motion-gather-preview': 'Connect',
      'motion-portfolio-preview': 'Field notes',
    }[scenario]
    await page.getByRole('button', { name: `Preview ${name} template`, exact: true }).click()
    await page
      .getByRole('slider', { name: 'Video playhead', exact: true })
      .fill(
        scenario === 'motion-dark-hook'
          ? '45'
          : scenario === 'motion-product-reveal'
            ? '150'
            : '180',
      )
  }
  if (scenario === 'motion-editor') {
    await page.getByRole('button', { name: /Motion study — demo.*Product/ }).click()
    await expect(page.getByRole('textbox', { name: 'Headline', exact: true })).toHaveValue(
      'Ideas,\nin motion.',
    )
    await page.getByRole('slider', { name: 'Video playhead', exact: true }).fill('36')
  }
}
export async function verifyMotion(page, scenario) {
  if (scenario === 'motion-template-return') {
    await expect(page.getByRole('region', { name: 'Video creation', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Typography', exact: true })).toBeVisible()
    const tile = page.getByRole('button', { name: 'Preview Type play template', exact: true })
    await expect(tile).toBeFocused()
    await expect(tile).toHaveAttribute('aria-pressed', 'true')
    await expect(
      page.getByRole('group', { name: 'Motion templates' }).getByRole('button'),
    ).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Use template', exact: true })).toHaveCount(0)
    return
  }
  if (scenario === 'motion-projects' || scenario === 'motion-empty') {
    await expect(page.getByRole('button', { name: 'Create video', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Motion templates' })).toHaveCount(0)
    await expect(page.getByText('Your videos', { exact: true })).toHaveCount(0)
    if (scenario === 'motion-empty')
      await expect(page.getByRole('button', { name: /Motion study — demo.*Product/ })).toHaveCount(
        0,
      )
    return
  }
  if (
    [
      'motion-template-preview',
      'motion-dark-hook',
      'motion-product-reveal',
      'motion-gather-preview',
      'motion-portfolio-preview',
    ].includes(scenario)
  ) {
    const name =
      scenario === 'motion-dark-hook'
        ? 'Blackout'
        : scenario === 'motion-product-reveal'
          ? 'Relay'
          : scenario === 'motion-gather-preview'
            ? 'Connect'
            : scenario === 'motion-portfolio-preview'
              ? 'Field notes'
              : 'Offbeat'
    await expect(
      page
        .getByRole('region', { name: 'Video creation', exact: true })
        .getByRole('heading', { name, exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use template', exact: true })).toBeEnabled()
    await expect(page.getByRole('img', { name: 'Motion video preview', exact: true })).toBeVisible()
    if (scenario === 'motion-gather-preview' || scenario === 'motion-portfolio-preview') {
      await expect(page.getByRole('slider', { name: 'Video playhead', exact: true })).toHaveValue(
        '180',
      )
      const colors = await page
        .getByRole('img', { name: 'Motion video preview', exact: true })
        .evaluate((canvas) => {
          const pixels = canvas
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height).data
          const colors = new Set()
          for (let i = 0; i < pixels.length; i += 64)
            colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
          return colors.size
        })
      expect(colors).toBeGreaterThan(20)
    }
    return
  }
  if (scenario === 'motion-library') {
    await expect(
      page.getByRole('group', { name: 'Motion templates', exact: true }).getByRole('button'),
    ).toHaveCount(templateIds.length - 1)
    await expect(
      page.getByRole('button', { name: 'Preview Daylight template', exact: true }),
    ).toBeVisible()
    return
  }
  await expect(page.getByRole('textbox', { name: 'Video title', exact: true })).toHaveValue(
    'Motion study — demo',
  )
  await expect(
    page.getByRole('group', { name: 'Video scenes', exact: true }).getByRole('button'),
  ).toHaveCount(4)
  await expect(page.getByRole('img', { name: 'Motion video preview', exact: true })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Video playhead', exact: true })).toHaveValue('36')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Export video', exact: true })).toBeEnabled()
  const colors = await page
    .getByRole('img', { name: 'Motion video preview', exact: true })
    .evaluate((canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const values = new Set()
      for (let index = 0; index < pixels.length; index += 64)
        values.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`)
      return values.size
    })
  expect(colors).toBeGreaterThan(20)
}
