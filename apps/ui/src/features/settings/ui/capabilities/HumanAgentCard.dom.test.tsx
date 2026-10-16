import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { AgentSummary } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const summary = (overrides: Partial<AgentSummary['record']>, source = 'local'): AgentSummary =>
  ({
    record: {
      id: 'builtin:human',
      kind: 'human',
      handle: 'human',
      label: 'Rus',
      description: 'Manual QA',
      instructions: '',
      leadershipPriority: 0,
      ...overrides,
    },
    builtin: true,
    enabled: true,
    source,
    path: '/p/.localix/agents/human.json',
    projectId: 'p',
    scope: 'project',
    invocations: {},
  }) as AgentSummary

test('the Human card edits only who the person is, counts toward the cap, and restores', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const getAgent = spyOn(backendClient, 'getAgent').mockResolvedValue(summary({}))
  const updateAgent = spyOn(backendClient, 'updateAgent').mockResolvedValue(summary({}))
  const resetAgent = spyOn(backendClient, 'resetAgent').mockResolvedValue(summary({}, 'builtin'))
  const { HumanAgentCard } = await import('./HumanAgentCard')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<HumanAgentCard scope="p" />))
    expect(getAgent).toHaveBeenCalledWith('human', 'p')
    expect(host.textContent).toContain('Rus')
    expect(host.textContent).toContain('Manual QA')

    const edit = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Edit')!
    await act(async () => edit.click())
    // Who the person is, and nothing that would run them.
    const labels = [...host.querySelectorAll('label')].map((label) => label.textContent ?? '')
    expect(labels.join('|')).not.toMatch(/Model|Tools|Skills|Priority|Permissions/)
    expect(host.textContent).toContain('9/1000')

    const notes = host.querySelectorAll('textarea')[1] as HTMLTextAreaElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(notes, 'x'.repeat(1000))
      notes.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.textContent).toContain('1009/1000')
    const save = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save')!
    expect(save.disabled).toBe(true)

    const restore = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Restore')!
    await act(async () => restore.click())
    expect(resetAgent).toHaveBeenCalledWith('human', 'p')
    expect(updateAgent).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    getAgent.mockRestore()
    updateAgent.mockRestore()
    resetAgent.mockRestore()
    mock.restore()
  }
})
