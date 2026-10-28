import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import type { Project } from '@/shared/api/contracts'
import { turns as settle } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

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

/** Mounts `element`, opens its menu from the trigger, and hands back the open menu's rows. */
async function openMenu(element: ReactElement) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(element))
  const trigger = host.querySelector<HTMLButtonElement>('button')!
  await act(async () => {
    trigger.focus()
    trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
  })
  const rows = () => [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
  return {
    act,
    trigger,
    rows,
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('the two pickers', () => {
  test('the project picker offers no agents — a project is not a permission scope', async () => {
    // The whole reason these are two controls. An agent in this list claimed an authority a
    // project has never had: rules belong to an agent, and a project decides what is
    // installed. One dropdown answering both made "No project" read as a third scope.
    const { ProjectSwitcher } = await import('./ScopeSwitcher')
    const picked: string[] = []
    const view = await openMenu(
      <ProjectSwitcher project="" onChange={(id) => picked.push(id)} projects={[project]} />,
    )
    try {
      expect(view.trigger.getAttribute('aria-label')).toBe('Project: No project. Change')
      const rows = view.rows()
      expect(rows.map((row) => row.textContent)).toEqual(['No project', 'Localix'])
      expect(rows.every((row) => row.getAttribute('role') === 'menuitemradio')).toBe(true)
      expect(rows[0]?.getAttribute('aria-checked')).toBe('true')
      await view.act(async () => {
        rows[1]!.click()
        await settle()
      })
      expect(picked).toEqual(['project-1'])
    } finally {
      await view.cleanup()
    }
  })

  test('the agent picker marks the default on the real row, never as a second one', async () => {
    // A synthetic "Default assistant" option named the same agent the list already carried,
    // so the picker offered one role twice and neither entry said they were the same thing.
    // `''` still means "none named" — it resolves to that row rather than rendering blank.
    // "default" is the row's hint, not part of its name.
    const { AgentSwitcher } = await import('./AgentSwitcher')
    const view = await openMenu(
      <AgentSwitcher
        agentId=""
        onChange={() => {}}
        agents={[
          { id: DEFAULT_AGENT_ID, label: 'Localix' },
          { id: 'a1', label: 'Code reviewer' },
        ]}
      />,
    )
    try {
      expect(view.trigger.getAttribute('aria-label')).toBe(
        'Agent whose rules to edit: Localix. Change',
      )
      const [first, second] = view.rows()
      expect(first?.getAttribute('aria-checked')).toBe('true')
      // Each row leads with the agent's monogram ("LO"), the way its replies are signed.
      expect(first?.textContent).toStartWith('LO')
      expect(first?.textContent).toEndWith('Localixdefault')
      expect(second?.textContent).toEndWith('Code reviewer')
      expect(document.body.textContent).not.toContain('Localix · default')
      expect(document.body.textContent).not.toContain('Default assistant')
    } finally {
      await view.cleanup()
    }
  })

  test('the Project tab picker says when there is nothing to pick, as a row', async () => {
    const { ProjectScopeSelect } = await import('./ScopeSwitcher')
    const created: true[] = []
    const view = await openMenu(
      <ProjectScopeSelect
        projects={[]}
        activeId={null}
        onSelect={() => {}}
        onCreate={() => created.push(true)}
      />,
    )
    try {
      const rows = view.rows()
      expect(rows.map((row) => row.textContent)).toEqual(['No projects yet', 'New project'])
      expect(rows[0]?.getAttribute('aria-disabled')).toBe('true')
      await view.act(async () => {
        rows[1]!.click()
        await settle()
      })
      expect(created).toEqual([true])
    } finally {
      await view.cleanup()
    }
  })
})
