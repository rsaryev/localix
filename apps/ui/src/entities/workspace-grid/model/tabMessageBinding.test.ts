import { describe, expect, it } from 'bun:test'
import type { WorkItem } from '@/shared/lib/workItem'
import { setEnabledMiniAppNames } from '@/shared/contrib/miniAppActivation'
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
          source: 'mini-app',
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
      source: 'mini-app',
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
      kind: 'test-empty-mini-app-view',
      Component: (() => null) as never,
      Icon: (() => null) as never,
      agentContext: {
        tools: ['fixture_tool'],
        nextSteps: ['Inspect the fixture.'],
      },
    })
    const bindings = workItemToMessageBindings(
      item({ kind: 'test-empty-mini-app-view', title: 'Empty fixture' }),
    )
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.target.attributes?.content).toContain('Live state: none published yet')
    expect(bindings[0]?.target.attributes?.content).toContain('fixture_tool')
    // No owning mini app, no address to give: the browser line is only for a mini app's own view.
    expect(bindings[0]?.target.attributes?.content).not.toContain('mini-app:')
  })

  it("tells the agent the address of a mini app's own view", () => {
    workItemKindRegistry.register({
      kind: 'fixture-mini-app:view',
      miniAppName: 'fixture-mini-app',
      Component: (() => null) as never,
      Icon: (() => null) as never,
      agentContext: { nextSteps: ['Inspect it.'] },
    } as never)
    setEnabledMiniAppNames(new Set(['fixture-mini-app']))
    try {
      const [binding] = workItemToMessageBindings(item({ kind: 'fixture-mini-app:view' }))
      expect(binding?.target.attributes?.content).toContain(
        'the Browser tool with url "mini-app:fixture-mini-app"',
      )
    } finally {
      workItemKindRegistry.removeOwner('fixture-mini-app')
      setEnabledMiniAppNames(null)
    }
  })

  // The owner is what brings the mini app's tools to the turn — so the HOST says it, on every facet
  // the tab links, over whatever a mini app's own draft claimed.
  it("stamps each of a mini app tab's bindings with its owner, over the mini app's own claim", () => {
    workItemKindRegistry.register({
      kind: 'fixture-mini-app:board',
      miniAppName: 'fixture-mini-app',
      Component: (() => null) as never,
      Icon: (() => null) as never,
      toMessageBinding: () => ({
        ...resourceMessageBindingDraft({ uri: 'localix://resource/fixture/1', label: 'one' }),
        miniApp: 'another-mini-app',
      }),
    } as never)
    setEnabledMiniAppNames(new Set(['fixture-mini-app']))
    try {
      const bindings = workItemToMessageBindings(item({ kind: 'fixture-mini-app:board' }))
      expect(bindings.length).toBeGreaterThan(1)
      expect(bindings.map((binding) => binding.miniApp)).toEqual(
        bindings.map(() => 'fixture-mini-app'),
      )
    } finally {
      workItemKindRegistry.removeOwner('fixture-mini-app')
      setEnabledMiniAppNames(null)
    }
  })

  it('a core tab has no owner, and a mini-app-view tab names the mini app it shows', () => {
    const file = workItemToMessageBinding(
      item({ kind: 'file', title: 'a.ts', payload: { path: '/a.ts' } }),
    )
    expect(file).not.toHaveProperty('plugin')
    const view = workItemToMessageBindings(
      item({ kind: 'mini-app-view', title: 'Board', payload: { miniAppName: 'fixture-board' } }),
    )
    expect(view.length).toBeGreaterThan(0)
    expect(view.every((binding) => binding.miniApp === 'fixture-board')).toBe(true)
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
        item({ id: 'snippet-view', kind: 'test-live-snippet-view', title: 'Request Console' }),
      )
      expect(bindings).toHaveLength(1)
      expect(bindings[0]?.target.attributes?.content).toContain('No saved requests.')
      expect(bindings[0]?.target.attributes?.content).toContain('fixture_tool')
    } finally {
      clearLiveTabMessageContext()
    }
  })
})
