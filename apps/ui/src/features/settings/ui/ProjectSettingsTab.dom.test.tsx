import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Project } from '@/shared/api/contracts'
import { registerDom } from '@localixai/kit/testing/dom'
import { ProjectSettingsTab } from './ProjectSettingsTab'

const project: Project = {
  id: 'project-1',
  userId: 'user-1',
  name: 'Localix',
  workingDir: '/workspace/localix',
  settings: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isDefault: false,
}

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

async function mount() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  const closed: string[] = []
  const render = (projects: Project[]) =>
    act(async () => {
      root.render(
        <ProjectSettingsTab
          projects={projects}
          activeId={project.id}
          picker={null}
          onClose={() => closed.push('preferences')}
        />,
      )
    })
  return { container, closed, render, done: () => act(async () => root.unmount()) }
}

describe('the project settings tab', () => {
  test('a project removed while its settings are open steps back out of them', async () => {
    const view = await mount()
    await view.render([project])
    expect(view.container.querySelector('input')?.value).toBe('Localix')
    await view.render([])
    expect(view.closed).toEqual(['preferences'])
    expect(view.container.textContent).not.toContain('Select a project')
    await view.done()
  })

  test('with no such project in the list, the page asks for one and stays', async () => {
    const view = await mount()
    await view.render([])
    expect(view.container.textContent).toContain('Select a project, or create one.')
    expect(view.closed).toEqual([])
    await view.done()
  })
})
