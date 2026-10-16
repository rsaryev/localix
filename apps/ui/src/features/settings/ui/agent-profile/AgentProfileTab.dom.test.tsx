import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { AgentSummary } from '@/shared/api/contracts'

await mock.module('../capabilities/agent-editor/AgentModelField', () => ({
  AgentModelField: () => null,
}))

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('agent navigation shares the settings shell and retains an unsaved definition across sections', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const agentsModule = await import('../../model/useAgents')
  const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')
  const { AgentProfileTab } = await import('./AgentProfileTab')
  const agent = {
    record: {
      id: 'reviewer-id',
      handle: 'reviewer',
      description: 'Reviews changes.',
      leadershipPriority: 0,
      instructions: 'Review code.',
    },
    builtin: false,
    enabled: true,
    source: 'local',
    path: '',
    projectId: '',
    scope: 'global',
    invocations: { chat: 'allow' },
  } as AgentSummary
  const update = mock(async () => agent)
  const registry = spyOn(agentsModule, 'useAgents').mockReturnValue({
    agents: [agent],
    loading: false,
    error: null,
    busy: null,
    busyLabel: null,
    refresh: () => {},
    create: async () => agent,
    update,
    toggle: async () => {},
    remove: async () => {},
    duplicate: async () => {},
    reset: async () => {},
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <WorkItemVisibilityProvider visible={false}>
          <AgentProfileTab agentId="reviewer-id" projectId="" />
        </WorkItemVisibilityProvider>,
      ),
    )
    expect(host.firstElementChild?.className).toContain('@container/settings')
    const navigation = host.querySelector('nav[aria-label="Agent profile sections"]')!
    expect(navigation.querySelectorAll('[role="group"]')).toHaveLength(2)
    expect(navigation.querySelectorAll('button')).toHaveLength(6)
    expect(host.querySelector('[aria-label="Agent section"]')).not.toBeNull()
    const prompt = host.querySelector<HTMLTextAreaElement>('#agent-instructions')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(
        prompt,
        'Review code and tests.',
      )
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const section = (name: string) =>
      [...navigation.querySelectorAll('button')].find((button) => button.textContent === name)!
    await act(async () => section('Tools').click())
    expect(navigation.querySelector('[aria-current="page"]')?.textContent).toBe('Tools')
    expect(prompt.closest('[hidden]')).not.toBeNull()
    expect(update).not.toHaveBeenCalled()
    await act(async () => section('Definition').click())
    expect(host.querySelector('#agent-instructions')).toBe(prompt)
    expect(prompt.closest('[hidden]')).toBeNull()
    expect(prompt.value).toBe('Review code and tests.')
    const save = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Save changes',
    )!
    expect(save.disabled).toBe(false)
    await act(async () => save.click())
    expect(update).toHaveBeenCalledWith(
      agent,
      expect.objectContaining({ instructions: 'Review code and tests.' }),
    )
    const reveal = (section: 'rules' | 'definition', sectionRequestId: string) =>
      act(async () =>
        root.render(
          <WorkItemVisibilityProvider visible={false}>
            <AgentProfileTab
              agentId="reviewer-id"
              projectId=""
              section={section}
              sectionRequestId={sectionRequestId}
            />
          </WorkItemVisibilityProvider>,
        ),
      )
    await reveal('rules', 'first')
    expect(navigation.querySelector('[aria-current="page"]')?.textContent).toBe('Permission rules')
    await act(async () => section('Definition').click())
    await reveal('rules', 'again')
    expect(navigation.querySelector('[aria-current="page"]')?.textContent).toBe('Permission rules')
    await reveal('definition', 'edit')
    expect(prompt.closest('[hidden]')).toBeNull()
    expect(prompt.value).toBe('Review code and tests.')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    registry.mockRestore()
  }
})
