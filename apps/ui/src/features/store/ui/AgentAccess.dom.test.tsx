import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { listing } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
// A spy left on the shared `backendClient` would be read by the next file as its own calls.
afterAll(async () => {
  mock.restore()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const snapshot = (over: { skillOn: boolean }) =>
  ({
    revision: 1,
    scope: { projectId: '', agentId: 'reviewer' },
    plugins: [],
    miniApps: [],
    tools: { enabled: [], disabled: [], catalog: [], categoryLabels: {}, mcp: [] },
    views: [],
    agents: [],
    commands: [],
    mcp: [{ id: 'm1', name: 'github', enabled: true, projectId: '' }],
    skills: [
      {
        id: 's1',
        name: 'deploy',
        enabled: over.skillOn,
        description: 'Ship it',
        tags: [],
        projectId: '',
        scope: 'global',
        source: 'file',
      },
    ],
    tips: [],
    grammar: { kinds: [], effects: [], classes: [], examples: [] },
  }) as never

test('an agent’s Access tab switches what it may use, and each row opens its Store page', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
  const { __resetCapabilityCache } = await import('@/shared/contrib/capabilityCache')
  const { __resetMiniAppContrib } = await import('@/shared/contrib/enabledMiniApps')
  const { inspector } = await import('@/shared/lib/inspectorBus')
  const { AgentAccess } = await import('./AgentAccess')
  __resetMiniAppContrib()
  __resetCapabilityCache()
  // The server is the truth: after the write, a re-read answers with the skill off.
  let switched = false
  spyOn(backendClient, 'fetchCapabilitySnapshot').mockImplementation(async () =>
    snapshot({ skillOn: !switched }),
  )
  const apply = spyOn(backendClient, 'applyCapabilityRules').mockImplementation(async () => {
    switched = true
    return snapshot({ skillOn: false })
  })
  const opened = spyOn(inspector, 'openWorkItem').mockImplementation(() => {})

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const { act } = React
  await act(async () => {
    root.render(
      <WorkItemVisibilityProvider visible>
        <AgentAccess listing={listing({ id: 'reviewer' })} />
      </WorkItemVisibilityProvider>,
    )
  })
  await act(async () => settle())

  const byLabel = (label: string) =>
    container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!
  expect(container.textContent).toContain('/deploy')
  expect(container.textContent).toContain('github')

  await act(async () => byLabel('Open github in the Store').click())
  expect(opened.mock.calls[0]![0]).toMatchObject({
    workKind: 'store',
    payload: { ref: { kind: 'mcp-server', id: 'github' } },
  })

  await act(async () => byLabel('Disable /deploy for this agent').click())
  expect(apply).toHaveBeenCalledWith({
    agentId: 'reviewer',
    projectId: null,
    changes: [{ action: 'skill:deploy', resource: '*', effect: 'deny' }],
  })
  await act(async () => settle())
  expect(byLabel('Enable /deploy for this agent')).not.toBeNull()

  await act(async () => root.unmount())
  container.remove()
})
