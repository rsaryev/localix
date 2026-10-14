import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { SkillsData } from './useSkills'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
/**
 * A SPY LEFT ON `backendClient` IS READ BY THE NEXT FILE AS ITS OWN CALLS.
 *
 * `spyOn` over an already-spied method hands back the SAME spy, history included, and
 * `backendClient` is one process-wide object shared by every test file in the run. So a spy this
 * file never restores makes another file's `toHaveBeenCalledTimes(0)` count the clicks made here
 * — which is how the warm-hidden Settings test failed in a full run and passed on its own.
 * Restoring in `afterAll` covers a failed test too, where per-spy cleanup at the end of the body
 * would be skipped.
 */
afterAll(async () => {
  mock.restore()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const snapshotWith = (skills: unknown[]) =>
  ({
    revision: 1,
    scope: { projectId: '', agentId: null },
    plugins: [],
    tools: {
      enabled: [],
      disabled: [],
      catalog: [],
      categoryLabels: {},
      mcp: [],
      mcpUnprobedServers: [],
    },
    views: [],
    agents: [],
    commands: [],
    mcp: [],
    skills,
    tips: [],
    grammar: { kinds: [], effects: [], classes: [], examples: [] },
  }) as never

/**
 * Turning a skill off is a RULE about one agent — the same shape the tool, plugin and MCP
 * switches write, and the reason a skill could only be denied by hand until now.
 *
 * The scope is what this pins. The switch sits on a screen that is about one agent, so the
 * write has to name that agent: sent scopeless it would land on the agent that always exists
 * and silently take the skill away from the wrong one.
 */
test('a skill switch writes its agent’s rule, not the default assistant’s', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act } = React
  const { backendClient } = await import('@/shared/api/client')
  const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')
  const { __resetCapabilityCache } = await import('@/shared/contrib/capabilityCache')
  const { __resetPluginContrib } = await import('@/shared/contrib/enabledPlugins')
  const { useSkills } = await import('./useSkills')
  __resetPluginContrib()
  __resetCapabilityCache()

  const skill = {
    id: 's1',
    name: 'deploy',
    enabled: true,
    description: 'Ship it',
    tags: [],
    projectId: '',
    scope: 'global',
    source: 'file',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
  spyOn(backendClient, 'fetchCapabilitySnapshot').mockResolvedValue(snapshotWith([skill]))
  spyOn(backendClient, 'listCuratorSkills').mockResolvedValue([] as never)
  const apply = spyOn(backendClient, 'applyCapabilityRules').mockResolvedValue(
    snapshotWith([{ ...skill, enabled: false }]),
  )

  let data!: SkillsData
  function Probe() {
    data = useSkills('', 'agent:reviewer')
    return null
  }

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <WorkItemVisibilityProvider visible>
        <Probe />
      </WorkItemVisibilityProvider>,
    )
  })
  await act(async () => settle())

  expect(data.skills.map((row) => row.name)).toEqual(['deploy'])
  await act(async () => {
    await data.toggle(data.skills[0]!)
  })

  expect(apply).toHaveBeenCalledWith({
    // An agent scope carries no project: an agent's rules follow it wherever it runs.
    agentId: 'reviewer',
    projectId: null,
    changes: [{ action: 'skill:deploy', resource: '*', effect: 'deny' }],
  })
  // The answer is the new state — the row follows the document, not the optimistic flip.
  expect(data.skills[0]!.enabled).toBe(false)

  await act(async () => root.unmount())
  container.remove()
})
