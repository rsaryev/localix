import { describe, expect, it } from 'bun:test'
import type { WorkItem } from '@/shared/lib/workItem'
import { setEnabledPluginNames } from '@/shared/contrib/pluginActivation'
import { workItemKindRegistry } from '@/shared/contrib/uiContrib'
import { workItemToMessageBinding, workItemToMessageBindings } from './tabMessageBinding'
import { clearLiveTabMessageContext, publishLiveTabMessageContext } from './liveTabMessageContext'
import { resourceMessageBindingDraft, snippetMessageBindingDraft } from '@localixai/mini-app-sdk/ui'

const item = (over: Partial<WorkItem>): WorkItem => ({ kind: 'file', id: 'x', title: 'X', ...over })

describe('workItemToMessageBinding', () => {
  it('maps a file/diff tab to a file ref', () => {
    expect(
      workItemToMessageBinding(item({ kind: 'file', title: 'a.ts', payload: { path: '/a.ts' } })),
    ).toMatchObject({
      kind: 'context',
      target: { kind: 'file', token: '@/a.ts', label: 'a.ts', attributes: { path: '/a.ts' } },
    })
    expect(
      workItemToMessageBinding(item({ kind: 'diff', payload: { path: '/b.ts' } }))?.target.kind,
    ).toBe('file')
  })

  it("delegates to a contributed kind's `toMessageBinding`", () => {
    // A subsystem contributes its own tab→ref mapping via the registry; core consults it
    // FIRST. Register a synthetic kind to prove the generic seam (no core db literal).
    workItemKindRegistry.register({
      kind: 'test-console',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Component: (() => null) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Icon: (() => null) as any,
      toMessageBinding: (i) => {
        if (typeof i.payload?.connectionId !== 'string') return null
        const uri = `localix://resource/fixture-db/${i.payload.connectionId}`
        return {
          kind: 'context',
          source: 'plugin',
          target: { kind: 'resource', token: `@resource:${uri}`, label: i.title, uri },
        }
      },
    })
    expect(
      workItemToMessageBinding(
        item({ kind: 'test-console', title: 'prod', payload: { connectionId: 'c1' } }),
      ),
    ).toEqual({
      kind: 'context',
      source: 'plugin',
      target: {
        kind: 'resource',
        token: '@resource:localix://resource/fixture-db/c1',
        label: 'prod',
        uri: 'localix://resource/fixture-db/c1',
      },
    })
  })

  it('tells a contributed kind the chat a session tab belongs to, and null for a global tab', () => {
    const seen: unknown[] = []
    workItemKindRegistry.register({
      kind: 'test-session-board',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Component: (() => null) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Icon: (() => null) as any,
      toMessageBinding: (_item, context) => {
        seen.push(context)
        return null
      },
    })
    workItemToMessageBinding(item({ kind: 'test-session-board', scope: 's1' }))
    workItemToMessageBinding(item({ kind: 'test-session-board', scope: '@global' }))
    workItemToMessageBinding(item({ kind: 'test-session-board' }))
    expect(seen).toEqual([{ session: 's1' }, { session: null }, { session: null }])
  })

  it('maps a terminal tab to a terminal ref', () => {
    expect(
      workItemToMessageBinding(item({ kind: 'terminal', payload: { terminalId: 't1' } }))?.target
        .attributes?.terminalId,
    ).toBe('t1')
  })

  it('returns null for non-linkable tabs and missing payload', () => {
    expect(workItemToMessageBinding(item({ kind: 'settings' }))).toBeNull()
    expect(workItemToMessageBinding(item({ kind: 'file', payload: {} }))).toBeNull()
    expect(workItemToMessageBinding(undefined)).toBeNull()
  })

  it('gives every contributed work item guidance even before it publishes live state', () => {
    workItemKindRegistry.register({
      kind: 'test-empty-plugin-view',
      Component: (() => null) as never,
      Icon: (() => null) as never,
      agentContext: {
        tools: ['fixture_tool'],
        nextSteps: ['Inspect the fixture.'],
      },
    })
    const bindings = workItemToMessageBindings(
      item({ kind: 'test-empty-plugin-view', title: 'Empty fixture' }),
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.target.attributes?.content).toContain('Live state: none published yet')
    expect(bindings[0]?.target.attributes?.content).toContain('fixture_tool')
    // No owning plugin, no address to give: the browser line is only for a plugin's own view.
    expect(bindings[0]?.target.attributes?.content).not.toContain('plugin:')
  })

  it("tells the agent the address of a plugin's own view", () => {
    workItemKindRegistry.register({
      kind: 'fixture-plugin:view',
      pluginName: 'fixture-plugin',
      Component: (() => null) as never,
      Icon: (() => null) as never,
      agentContext: { nextSteps: ['Inspect it.'] },
    } as never)
    setEnabledPluginNames(new Set(['fixture-plugin']))
    try {
      const [binding] = workItemToMessageBindings(item({ kind: 'fixture-plugin:view' }))
      expect(binding?.target.attributes?.content).toContain(
        'the browser tool with url "plugin:fixture-plugin"',
      )
    } finally {
      workItemKindRegistry.removeOwner('fixture-plugin')
      setEnabledPluginNames(null)
    }
  })

  // The owner is what brings the plugin's tools to the turn — so the HOST says it, on every facet
  // the tab links, over whatever a plugin's own draft claimed.
  it("stamps each of a plugin tab's bindings with its owner, over the plugin's own claim", () => {
    workItemKindRegistry.register({
      kind: 'fixture-plugin:board',
      pluginName: 'fixture-plugin',
      Component: (() => null) as never,
      Icon: (() => null) as never,
      toMessageBinding: () => ({
        ...resourceMessageBindingDraft({ uri: 'localix://resource/fixture/1', label: 'one' }),
        plugin: 'another-plugin',
      }),
    } as never)
    setEnabledPluginNames(new Set(['fixture-plugin']))
    try {
      const bindings = workItemToMessageBindings(item({ kind: 'fixture-plugin:board' }))
      expect(bindings.length).toBeGreaterThan(1)
      expect(bindings.map((binding) => binding.plugin)).toEqual(
        bindings.map(() => 'fixture-plugin'),
      )
    } finally {
      workItemKindRegistry.removeOwner('fixture-plugin')
      setEnabledPluginNames(null)
    }
  })

  it('a core tab has no owner, and a plugin-view tab names the plugin it shows', () => {
    const file = workItemToMessageBinding(
      item({ kind: 'file', title: 'a.ts', payload: { path: '/a.ts' } }),
    )
    expect(file).not.toHaveProperty('plugin')
    const view = workItemToMessageBindings(
      item({ kind: 'plugin-view', title: 'Board', payload: { pluginName: 'fixture-board' } }),
    )
    expect(view.length).toBeGreaterThan(0)
    expect(view.every((binding) => binding.plugin === 'fixture-board')).toBe(true)
  })

  it('retains guidance beside a resource when live state replaces the static binding', () => {
    workItemKindRegistry.register({
      kind: 'test-live-resource-view',
      Component: (() => null) as never,
      Icon: (() => null) as never,
      agentContext: { tools: ['fixture_tool'], nextSteps: ['Inspect it.'] },
    })
    publishLiveTabMessageContext('resource-view', {
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({ uri: 'localix://resource/fixture/1', label: 'one' }),
      ],
    })
    try {
      const bindings = workItemToMessageBindings(
        item({ id: 'resource-view', kind: 'test-live-resource-view' }),
      )
      expect(bindings.map((binding) => binding.target.kind)).toEqual(['resource', 'snippet'])
      expect(bindings[1]?.target.attributes?.content).toContain('fixture_tool')
    } finally {
      clearLiveTabMessageContext()
    }
  })

  it('merges guidance into an API-like live snapshot instead of adding a second snippet', () => {
    workItemKindRegistry.register({
      kind: 'test-live-snippet-view',
      Component: (() => null) as never,
      Icon: (() => null) as never,
      agentContext: { tools: ['fixture_tool'], nextSteps: ['Inspect the empty fixture.'] },
    })
    publishLiveTabMessageContext('snippet-view', {
      strategy: 'replace',
      bindings: [snippetMessageBindingDraft({ label: 'API state', content: 'No saved requests.' })],
    })
    try {
      const bindings = workItemToMessageBindings(
        item({ id: 'snippet-view', kind: 'test-live-snippet-view', title: 'API Client' }),
      )
      expect(bindings).toHaveLength(1)
      expect(bindings[0]?.target.attributes?.content).toContain('No saved requests.')
      expect(bindings[0]?.target.attributes?.content).toContain('fixture_tool')
    } finally {
      clearLiveTabMessageContext()
    }
  })
})
