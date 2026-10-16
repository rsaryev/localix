import { test, expect } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { capturePlan } from './plan.mjs'
import { compose } from './scenarios.mjs'
import { verifyEvidence } from './evidence.mjs'
import { captureRoot, fixtureFile, uiOrigin, verifyDemoRuntime } from './runtime.mjs'

test.beforeAll(async () => {
  await verifyDemoRuntime()
})
for (const [key, spec] of Object.entries(capturePlan)) {
  test(key, async ({ page }, testInfo) => {
    test.skip(
      spec.scenario === 'containers' && process.env.LOCALIX_CAPTURE_DOCKER !== '1',
      'Opt in to the demo Docker fixture; never capture unrelated containers.',
    )
    test.skip(
      Boolean(spec.requires && process.env[spec.requires] !== '1'),
      `Enable ${spec.requires} with its isolated dependency first.`,
    )
    const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
    // `/model` needs the same placeholder connection for its Provider step.
    if (['agent-command', 'model-command'].includes(spec.scenario))
      await (await import('./agent-command.mjs')).seedAgentCommand(fixture)
    if (['kanban-board', 'kanban-conversation'].includes(spec.scenario))
      await (await import('./kanban-workbenches.mjs')).seedKanban(fixture)
    if (spec.scenario === 'agent-management')
      await (await import('./agent-management.mjs')).seedAgentManagement(fixture)
    const board = spec.scenario === 'answer-board'
    const prefix = board
      ? 'board'
      : spec.scope === 'platform'
        ? 'platform'
        : spec.scope === 'external'
          ? 'external'
          : ''
    const route = `${uiOrigin}/#/project/${prefix ? fixture[`${prefix}ProjectId`] : fixture.projectId}/${prefix ? fixture[`${prefix}SessionId`] : fixture.sessionId}`
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    if (spec.theme)
      await page.addInitScript((theme) => localStorage.setItem('sandbox_theme', theme), spec.theme)
    await page.goto(route)
    await expect(page.getByRole('button', { name: 'Add participant', exact: true })).toBeVisible()
    await compose(page, spec.scenario)
    await verifyEvidence(page, spec.scenario)
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    if (!spec.preservePointer) await page.mouse.move(10, 10)
    await page.waitForTimeout(650)
    expect(errors).toEqual([])
    const date = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const root = process.env.LOCALIX_CAPTURE_RUN || path.join(captureRoot, 'review')
    const target = path.join(root, `${key}--${date}.png`)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await page.screenshot({ path: target, animations: 'disabled' })
    await testInfo.attach(key, { path: target, contentType: 'image/png' })
    await fs.writeFile(
      `${target}.json`,
      JSON.stringify({ key, date, purpose: spec.purpose, passed: true }),
    )
  })
}
