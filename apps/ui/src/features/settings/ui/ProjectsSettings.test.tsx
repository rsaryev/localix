import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Project } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { registerDom } from '@localixai/kit/testing/dom'
import { ProjectSettingsForm } from './ProjectsSettings'
import { turns as settle } from '@/testing/settle'

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
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('project settings presentation', () => {
  test('shows the danger zone and labelled fields with no in-flight labels at rest', () => {
    const html = renderToStaticMarkup(<ProjectSettingsForm project={project} />)

    expect(html).toContain('Danger zone')
    expect(html).not.toContain('Saving…')
    expect(html).not.toContain('Deleting…')
    expect(html).toContain('aria-label="Display name"')
    expect(html).toContain('aria-label="Custom system prompt"')
  })

  test('reports a failed blur save in the form instead of silently discarding it', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const update = spyOn(backendClient, 'updateProject').mockRejectedValue(
      new Error('Project settings are unavailable'),
    )
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(<ProjectSettingsForm project={project} />)
    })

    await act(async () => {
      container
        .querySelector('textarea')
        ?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await settle()
    })

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Project settings are unavailable',
    )
    await act(async () => root.unmount())
    update.mockRestore()
  })

  test('serializes back-to-back blur saves so the later intent cannot be overtaken', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    let resolveFirst!: (value: Project) => void
    let resolveSecond!: (value: Project) => void
    const first = new Promise<Project>((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise<Project>((resolve) => {
      resolveSecond = resolve
    })
    const update = spyOn(backendClient, 'updateProject')
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second)
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(<ProjectSettingsForm project={project} />)
    })

    await act(async () => {
      container.querySelector('input')?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      container
        .querySelector('textarea')
        ?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await Promise.resolve()
    })
    expect(update).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirst(project)
      await settle()
    })
    expect(update).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveSecond(project)
      await settle()
      root.unmount()
    })
    update.mockRestore()
  })

  test('a rename made elsewhere shows in the form, and the next save keeps it', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const update = spyOn(backendClient, 'updateProject').mockResolvedValue(project)
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => {
      root.render(<ProjectSettingsForm project={project} />)
    })
    const renamed = {
      ...project,
      name: 'Renamed',
      settings: { customSystemPrompt: 'Be brief' },
    } as Project
    await act(async () => {
      root.render(<ProjectSettingsForm project={renamed} />)
    })
    expect(container.querySelector('input')?.value).toBe('Renamed')
    expect(container.querySelector('textarea')?.value).toBe('Be brief')

    await act(async () => {
      container
        .querySelector('textarea')
        ?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      await settle()
    })
    expect(update.mock.calls[0]?.[1]).toMatchObject({
      name: 'Renamed',
      settingsPatch: { customSystemPrompt: 'Be brief' },
    })
    await act(async () => root.unmount())
    update.mockRestore()
  })
})
