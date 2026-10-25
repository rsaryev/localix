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
    if (spec.scenario === 'diagram-board')
      await (await import('./diagram-board.mjs')).seedDiagramBoard(fixture)
    if (spec.scenario === 'agent-management')
      await (await import('./agent-management.mjs')).seedAgentManagement(fixture)
    if (spec.scenario.startsWith('store')) await (await import('./store-seed.mjs')).seedStore()
    if (['local-models-settings', 'semantic-search'].includes(spec.scenario))
      await (await import('./local-models.mjs')).seedLocalModels()
    const board = spec.scenario === 'answer-board'
    const prefix = board
      ? 'board'
      : spec.scenario === 'diagram-board'
        ? 'diagram'
        : spec.scope === 'platform'
          ? 'platform'
          : spec.scope === 'external'
            ? 'external'
            : ''
    const route = `${uiOrigin}/#/project/${prefix ? fixture[`${prefix}ProjectId`] : fixture.projectId}/${prefix ? fixture[`${prefix}SessionId`] : fixture.sessionId}`
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    // A spec's own theme, or the theme and size a review run asks for (`LOCALIX_CAPTURE_THEME=light`,
    // `LOCALIX_CAPTURE_VIEWPORT=900x800`) to look at one scenario at another width.
    const theme = process.env.LOCALIX_CAPTURE_THEME || spec.theme
    if (theme)
      await page.addInitScript((value) => localStorage.setItem('sandbox_theme', value), theme)
    const size = process.env.LOCALIX_CAPTURE_VIEWPORT?.match(/^(\d+)x(\d+)$/)
    if (size) await page.setViewportSize({ width: Number(size[1]), height: Number(size[2]) })
    // Setup opens by itself until it has been closed once on a device; a capture is not a first
    // launch, and the open dialog covered every surface a scenario reached for.
    if (!spec.firstRun)
      await page.addInitScript(() => localStorage.setItem('localix.setup.done', '1'))
    const island = spec.scenario.startsWith('island-')
    if (island) {
      await (
        await import('./agent-island.mjs')
      ).openIsland(page, uiOrigin, spec.notch, spec.scenario)
    } else if (spec.firstRun) {
      // No saved UI state, cleared once so a reload inside the scenario keeps what it wrote.
      await page.addInitScript(() => {
        if (sessionStorage.getItem('capture_first_run')) return
        localStorage.clear()
        sessionStorage.setItem('capture_first_run', '1')
      })
      await page.goto(`${uiOrigin}/#/`)
    } else if (spec.start === 'home' || spec.start === 'project') {
      // Workspace-wide surfaces (Settings, Search) need no conversation open; `project` makes the
      // fixture project active first, because search is scoped to the active project.
      await page.goto(spec.start === 'home' ? `${uiOrigin}/#/` : route)
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    } else {
      await page.goto(route)
      await expect(page.getByRole('button', { name: 'Add participant', exact: true })).toBeVisible()
    }
    await compose(page, spec.scenario)
    await verifyEvidence(page, spec.scenario)
    if (spec.notch) await (await import('./agent-island.mjs')).verifyNotchLayout(page, spec)
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    if (!spec.preservePointer) await page.mouse.move(10, 10)
    await page.waitForTimeout(650)
    expect(errors).toEqual([])
    // Validate the state we actually capture after pointer movement and settled transitions.
    if (island) await verifyEvidence(page, spec.scenario)
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
