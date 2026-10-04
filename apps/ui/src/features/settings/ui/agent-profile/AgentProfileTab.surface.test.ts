import { expect, test } from 'bun:test'
import surface from './AgentProfileTab.surface'
import { createUiLocationRegistry } from '@/shared/contrib/uiLocations'
import { agentProfileUri } from '@/shared/contrib/useAgentIdentity'
import { agentProfileTabId } from '../../model/agentProfileTab'

/**
 * The click and the destination, checked END TO END through the real registry.
 *
 * Every agent avatar, mention and registry row navigates by URI, and a URI only opens
 * something if the contribution is ADMITTED by the registry and its arguments parse. Calling
 * `resolve` directly would pass while either of those silently failed — which is exactly the
 * shape of failure a click has: nothing happens, and nothing says why.
 */
test('an agent’s URI opens that agent’s profile tab', () => {
  const registry = createUiLocationRegistry()
  expect(registry.register(surface)).toBe(true)

  const uri = agentProfileUri({ agentId: 'builtin:lead', handle: 'lead', name: 'Lead', scope: '' })
  expect(registry.resolve(uri)?.target).toEqual({
    kind: 'work-item',
    workKind: 'agent',
    id: agentProfileTabId('builtin:lead', ''),
    // The name comes from the live capability document, which no test process has loaded — so
    // this is the fallback: the id, read as words. The tab still opens, and the profile it
    // renders replaces the title with what the record says.
    title: 'Builtin:lead',
    payload: { agentId: 'builtin:lead', projectId: '' },
  })
})

test('a project agent keeps its scope, so the profile is the record that was clicked', () => {
  const registry = createUiLocationRegistry()
  registry.register(surface)

  // The same handle can exist globally and inside a project. A scope dropped on the way here
  // would open the OTHER record — or, in a scope that has neither, nothing at all.
  const uri = agentProfileUri({ agentId: 'a1', handle: 'qa', name: 'QA', scope: 'proj-7' })
  expect(registry.resolve(uri)?.target).toMatchObject({
    id: agentProfileTabId('a1', 'proj-7'),
    payload: { agentId: 'a1', projectId: 'proj-7' },
  })
})
