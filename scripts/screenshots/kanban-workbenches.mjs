import { promises as fs } from 'node:fs'
import { expect } from '@playwright/test'
import { api, fixtureFile, verifyDemoRuntime } from './runtime.mjs'
import { button, openTool } from './scenarios.mjs'

const cards = [
  {
    title: 'Review the workspace layout',
    status: 'done',
    agent: 'frontend',
    labels: ['interface'],
  },
  { title: 'Check the release states', status: 'done', agent: 'qa', labels: ['tests'] },
  {
    title: 'Review the mobile preview',
    status: 'ready',
    agent: 'frontend',
    labels: ['responsive'],
  },
  { title: 'Write release notes', status: 'backlog', agent: 'lead', labels: ['docs'] },
]

export async function seedKanban(
  fixture,
  { request = api, verifyRuntime = verifyDemoRuntime } = {},
) {
  await verifyRuntime()
  const [session, project] = await Promise.all([
    request(`/sessions/${fixture.sessionId}`),
    request(`/projects/${fixture.projectId}`),
  ])
  if (
    session.projectId !== fixture.projectId ||
    (await fs.realpath(project.workingDir)) !== (await fs.realpath(fixture.root))
  )
    throw new Error('Kanban capture must belong to the dedicated fixture project.')
  const route = (suffix) => `/kanban${suffix}?sessionId=${fixture.sessionId}`
  const board = await request(route('/board'))
  if (board.tasks.some((task) => !cards.some((card) => card.title === task.title)))
    throw new Error('The fixture board contains unrelated cards; refusing to reset it.')
  for (const card of cards) {
    const existing = board.tasks.find((task) => task.title === card.title)
    const fields = { ...card, description: 'Illustrative fixture state, not a recorded agent run.' }
    if (existing)
      await request(
        route(`/tasks/${existing.id}`),
        { ...fields, expectedUpdatedAt: existing.updatedAt },
        'PATCH',
      )
    else await request(route('/tasks'), fields)
  }
}

export async function composeKanban(page, scenario) {
  await openTool(page, 'Board')
  const notes = page.getByRole('button', { name: 'Open task: Write release notes', exact: true })
  await notes.focus()
  await notes.press('Alt+ArrowRight')
  await expect(page.getByRole('group', { name: /^Ready column/ })).toContainText(
    'Write release notes',
  )
  if (scenario === 'kanban-conversation') {
    await button(page, 'Restore layout').click()
    await expect(page.getByRole('combobox', { name: 'Message', exact: true }).last()).toBeVisible()
  }
}

export async function verifyKanban(page, scenario) {
  for (const card of cards) {
    await expect(
      page.getByRole('button', { name: `Open task: ${card.title}`, exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: `Open task: ${card.title}`, exact: true }),
    ).toBeInViewport({ ratio: 1 })
  }
  await expect(page.getByRole('group', { name: /^Done column/ })).toContainText(
    'Check the release states',
  )
  await expect(
    page
      .getByRole('button', { name: 'Open task: Review the mobile preview', exact: true })
      .getByTitle('Assigned to @frontend', { exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('button', { name: 'Open task: Write release notes', exact: true })
      .getByTitle('Assigned to @lead', { exact: true }),
  ).toBeVisible()
  const fixture = JSON.parse(await fs.readFile(fixtureFile, 'utf8'))
  const board = await api(`/kanban/board?sessionId=${fixture.sessionId}`)
  expect(board.tasks.find((task) => task.title === 'Write release notes')?.status).toBe('ready')
  expect(board.tasks).toHaveLength(4)
  if (scenario === 'kanban-conversation')
    await expect(page.getByRole('combobox', { name: 'Message', exact: true }).last()).toBeVisible()
}
