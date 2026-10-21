import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { AttentionItem } from '@localixai/api/client'
import type { UiSession } from '@/shared/api/contracts'
import type { InspectorRequest } from '@/shared/lib/inspectorBus'

let teardown: () => Promise<void>
const cleanups: Array<() => unknown> = []

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const planItem: AttentionItem = {
  key: 'plan:root-1:plan-2',
  kind: 'plan',
  sessionId: 'root-1',
  at: '2026-10-03T10:00:00.000Z',
  title: 'Cache layer',
  summary: ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6', 'Line 7'].join('\n'),
  subject: { planId: 'plan-2', version: 2, agentHandle: 'lead' },
}

async function stubBackend(given: Record<string, (...args: never[]) => unknown>) {
  const { backendClient } = await import('@/shared/api/client')
  const { resetPlanCommentsForTest } = await import('../../model/planComments')
  resetPlanCommentsForTest()
  // The plan body reads the version's comments to choose the step it suggests: none by default.
  const stubs = { listComments: mock(async () => []), ...given }
  const target = backendClient as unknown as Record<string, unknown>
  const originals = Object.fromEntries(Object.keys(stubs).map((key) => [key, target[key]]))
  Object.assign(target, stubs)
  cleanups.push(() => Object.assign(target, originals))
}

async function render(items: AttentionItem[], activeSessionId: string | null = 'other') {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter, useLocation } = await import('react-router')
  const { useChatStore } = await import('../../model/store')
  const { applyAttentionRoster, resetAttentionForTests } =
    await import('../../model/attention/store')
  const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
  const { AttentionDialog } = await import('./AttentionDialog')

  const opened: InspectorRequest[] = []
  cleanups.push(registerInspectorHandler((request) => void opened.push(request)))
  let path = ''
  function Where() {
    path = useLocation().pathname
    return null
  }
  await React.act(async () => {
    resetAttentionForTests()
    useChatStore.setState({
      activeSessionId,
      allSessions: [
        {
          id: 'root-1',
          title: 'Billing',
          projectId: 'p1',
          agents: [
            { agentId: 'builtin:lead', handle: 'lead' },
            { agentId: 'builtin:builder', handle: 'builder' },
          ],
          rootSessionId: null,
        },
      ] as unknown as UiSession[],
    })
    applyAttentionRoster(items)
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/']}>
        <Where />
        <AttentionDialog />
      </MemoryRouter>,
    )
    await settle()
  })
  cleanups.push(async () => {
    await React.act(async () => root.unmount())
    host.remove()
    resetAttentionForTests()
  })
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
  const button = (text: string) =>
    [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((candidate) =>
      candidate.textContent?.trim().startsWith(text),
    )
  return { act: React.act, dialog, button, opened, path: () => path }
}

describe('the attention dialog, for a presented plan', () => {
  test('names the chat, who presented which version, the title and a cut excerpt', async () => {
    await stubBackend({})
    const { dialog } = await render([planItem])
    const text = dialog()?.textContent ?? ''
    expect(text).toContain('Billing')
    expect(text).toContain('@lead presented plan v2')
    expect(text).toContain('Cache layer')
    expect(text).toContain('Line 6')
    expect(text).not.toContain('Line 7')
  })

  test('suggests Approve, or Open plan when the version holds comments to send from its tab', async () => {
    const marked = (element: Element | null | undefined) =>
      element?.getAttribute('data-recommended') === 'true'
    await stubBackend({})
    const clean = await render([planItem])
    expect(marked(clean.dialog()?.querySelector('button[aria-label="Approve plan"]'))).toBe(true)
    expect(marked(clean.button('Open plan'))).toBe(false)
    expect(marked(clean.button('Set aside'))).toBe(false)
    await clean.act(async () => {
      while (cleanups.length) await cleanups.pop()?.()
    })

    const open = {
      id: 'c1',
      scope: 'plan:plan-2',
      anchor: { quote: 'Line 1' },
      body: 'Why?',
      status: 'open',
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
    }
    await stubBackend({ listComments: mock(async () => [open]) })
    const commented = await render([planItem])
    expect(marked(commented.button('Open plan'))).toBe(true)
    expect(marked(commented.dialog()?.querySelector('button[aria-label="Approve plan"]'))).toBe(
      false,
    )
  })

  test('Approve opens the menu, approves that version with the mode and agent, then leaves', async () => {
    const approvePlan = mock(async () => ({ plan: {}, wake: 'delivered' }))
    await stubBackend({ approvePlan })
    const { act, dialog } = await render([planItem])
    const trigger = dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Approve plan"]')!
    const click = async (element: HTMLElement | undefined) => {
      expect(element).toBeDefined()
      await act(async () => {
        element!.click()
        await settle()
      })
    }
    await act(async () => {
      trigger.focus()
      trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle()
    })
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
    expect(menu.textContent).toContain('Approve plan v2')
    // A row by its label: the first truncating span, past a monogram's letters.
    const rowIn = (role: string, name: string) =>
      [...document.body.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find(
        (element) => element.querySelector('.truncate')?.textContent === name,
      )
    await click(rowIn('menuitem', 'Agent'))
    // Any agent is preselected; the item names the author by handle, so it leads, marked.
    expect(rowIn('menuitemradio', 'Any agent')?.getAttribute('aria-checked')).toBe('true')
    expect(rowIn('menuitemradio', 'Lead')?.textContent).toContain('Wrote the plan')
    await click(rowIn('menuitemradio', 'Builder'))
    await click(rowIn('menuitem', 'Mode'))
    await click(rowIn('menuitemradio', 'Bypass'))
    await click(rowIn('menuitem', 'Approve'))
    expect(approvePlan).toHaveBeenCalledWith('root-1', 'plan-2', 'bypass', 'builder')
    expect(dialog()).toBeNull()
  })

  test('Open plan goes to the chat and opens that version in its plan tab', async () => {
    await stubBackend({})
    const { act, button, dialog, opened, path } = await render([planItem])
    await act(async () => {
      button('Open plan')?.click()
      await settle()
    })
    expect(path()).toContain('root-1')
    expect(opened).toContainEqual(
      expect.objectContaining({
        kind: 'work-item',
        workKind: 'plan',
        scope: 'root-1',
        payload: { ownerId: 'root-1', planId: 'plan-2' },
      }),
    )
    expect(dialog()).toBeNull()
  })

  test('a plan outranks a newer mention, and nothing is raised for the chat on screen', async () => {
    await stubBackend({})
    const mention: AttentionItem = {
      key: 'mention:root-1:m1',
      kind: 'mention',
      sessionId: 'root-1',
      at: '2026-10-03T11:00:00.000Z',
      title: 'Question',
      summary: 'Which region?',
      subject: { messageId: 'm1', agentHandle: 'lead' },
    }
    const shown = await render([mention, planItem])
    expect(shown.dialog()?.textContent).toContain('presented plan')
    await shown.act(async () => {
      while (cleanups.length) await cleanups.pop()?.()
    })
    const here = await render([mention, planItem], 'root-1')
    expect(here.dialog()).toBeNull()
  })
})
