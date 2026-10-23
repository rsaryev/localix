import { describe, expect, test } from 'bun:test'

import {
  createPanelActions,
  registerPanelAction,
  clearPanelActions,
} from '@/shared/contrib/miniAppPanelActions'

/**
 * The capability-limited action table bridged panels may invoke. `sendPrompt`
 * must keep its guards (non-empty text, live session) — here
 * they surface as thrown errors so the bridge can post a correlated `error`.
 */

const ctx = { pluginName: 'sample-plugin', projectId: '', panelName: 'demo' }

function makeDeps(sessionId: string | null) {
  const sends: Array<{ sessionId: string; text: string }> = []
  return {
    sends,
    deps: {
      getSessionId: () => sessionId,
      sendMessage: async (sid: string, text: string) => {
        sends.push({ sessionId: sid, text })
        return {}
      },
    },
  }
}

describe('createPanelActions', () => {
  test('ping echoes its payload (and defaults to "pong")', async () => {
    const { deps } = makeDeps('s1')
    const actions = createPanelActions(deps)
    expect(await actions.get('ping')!({ a: 1 }, ctx)).toEqual({ a: 1 })
    expect(await actions.get('ping')!(undefined, ctx)).toBe('pong')
  })

  test("sendPrompt trims and sends into the view's own session", async () => {
    const { deps, sends } = makeDeps('session-42')
    const actions = createPanelActions(deps)
    const result = await actions.get('sendPrompt')!({ text: '  run the tests  ' }, ctx)
    expect(result).toEqual({ sent: true })
    expect(sends).toEqual([{ sessionId: 'session-42', text: 'run the tests' }])
  })

  test('sendPrompt accepts a bare string payload', async () => {
    const { deps, sends } = makeDeps('s1')
    await createPanelActions(deps).get('sendPrompt')!('hello', ctx)
    expect(sends).toEqual([{ sessionId: 's1', text: 'hello' }])
  })

  test('sendPrompt GUARDS: blank text and missing session both throw (no send)', async () => {
    const { deps, sends } = makeDeps(null)
    const actions = createPanelActions(deps)
    expect(actions.get('sendPrompt')!({ text: '   ' }, ctx)).rejects.toThrow('non-empty')
    expect(actions.get('sendPrompt')!({ text: 'hi' }, ctx)).rejects.toThrow(
      'belongs to no chat session',
    )
    expect(sends).toEqual([])
  })

  test('getContext returns the session id + theme + view identity (no secrets)', async () => {
    const actions = createPanelActions({
      getSessionId: () => 'session-7',
      sendMessage: async () => ({}),
      getTheme: () => 'light',
    })
    expect(await actions.get('getContext')!(undefined, ctx)).toEqual({
      sessionId: 'session-7',
      theme: 'light',
      plugin: 'sample-plugin',
      projectId: '',
      view: 'demo',
    })
  })

  test("callBackend binds the mounted plugin, project, view, and the view's own session", async () => {
    const calls: unknown[] = []
    const actions = createPanelActions({
      ...makeDeps('session-7').deps,
      invokeMiniAppBackend: async (input) => {
        calls.push(input)
        return { ok: true }
      },
    })
    expect(
      await actions.get('callBackend')!(
        { action: 'load.dashboard', payload: { page: 2 } },
        {
          ...ctx,
          projectId: 'project-1',
        },
      ),
    ).toEqual({ ok: true })
    expect(calls).toEqual([
      {
        app: 'sample-plugin',
        projectId: 'project-1',
        viewId: 'demo',
        sessionId: 'session-7',
        action: 'load.dashboard',
        payload: { page: 2 },
      },
    ])
  })

  test('callBackend rejects malformed actions before crossing the host boundary', () => {
    const actions = createPanelActions(makeDeps('s1').deps)
    expect(actions.get('callBackend')!({ action: '../other-plugin' }, ctx)).rejects.toThrow(
      'valid non-empty',
    )
  })

  test('getViewState/setViewState round-trip through the injected store, scoped per view', async () => {
    const store = new Map<string, unknown>()
    const deps = {
      getSessionId: () => 's1',
      sendMessage: async () => ({}),
      readViewState: (scope: string) => store.get(scope) ?? null,
      writeViewState: (scope: string, value: unknown) => void store.set(scope, value),
    }
    const actions = createPanelActions(deps, 'sample-plugin')
    expect(await actions.get('getViewState')!(undefined, ctx)).toBeNull()
    expect(await actions.get('setViewState')!({ tab: 2 }, ctx)).toEqual({ saved: true })
    expect(await actions.get('getViewState')!(undefined, ctx)).toEqual({ tab: 2 })
    // The scope embeds plugin+view, so another view's slot is untouched.
    expect(store.size).toBe(1)
    expect([...store.keys()][0]).toContain('sample-plugin')
  })

  test('view state is ISOLATED per (plugin, view) — no cross-plugin read', async () => {
    const store = new Map<string, unknown>()
    const deps = {
      getSessionId: () => 's1',
      sendMessage: async () => ({}),
      readViewState: (scope: string) => store.get(scope) ?? null,
      writeViewState: (scope: string, value: unknown) => void store.set(scope, value),
    }
    const xCtx = { pluginName: 'plugin-x', projectId: '', panelName: 'view' }
    const yCtx = { pluginName: 'plugin-y', projectId: '', panelName: 'view' }
    await createPanelActions(deps, 'plugin-x').get('setViewState')!({ secret: 'x' }, xCtx)
    // Y invokes getViewState with its OWN context → sees nothing of X's.
    expect(
      await createPanelActions(deps, 'plugin-y').get('getViewState')!(undefined, yCtx),
    ).toBeNull()
    expect(
      await createPanelActions(deps, 'plugin-x').get('getViewState')!(undefined, xCtx),
    ).toEqual({
      secret: 'x',
    })
  })

  test('the read-only context built-ins are available to EVERY plugin (authz unchanged)', () => {
    const anon = createPanelActions(makeDeps('s1').deps)
    const scoped = createPanelActions(makeDeps('s1').deps, 'anyPlugin')
    for (const table of [anon, scoped]) {
      expect(table.get('getContext')).toBeDefined()
      expect(table.get('getViewState')).toBeDefined()
      expect(table.get('setViewState')).toBeDefined()
      expect(table.get('publishMessageContext')).toBeDefined()
    }
  })

  test('publishMessageContext validates sandbox input and forces plugin provenance', async () => {
    const published: unknown[] = []
    const actions = createPanelActions({
      ...makeDeps('s1').deps,
      publishMessageContext: (context) => published.push(context),
    })
    expect(
      await actions.get('publishMessageContext')!(
        {
          strategy: 'replace',
          bindings: [
            {
              source: 'active-tab',
              target: {
                kind: 'resource',
                token: '@resource:wrong://target',
                label: 'Live view',
                uri: 'localix://resource/demo/current/view',
              },
            },
          ],
        },
        ctx,
      ),
    ).toEqual({ published: true, bindings: 1 })
    expect(published[0]).toEqual({
      strategy: 'replace',
      bindings: [
        {
          kind: 'context',
          source: 'plugin',
          target: {
            kind: 'resource',
            token: '@resource:localix://resource/demo/current/view',
            label: 'Live view',
            uri: 'localix://resource/demo/current/view',
          },
        },
      ],
    })

    expect(() =>
      actions.get('publishMessageContext')!({ strategy: 'replace', bindings: [] }, ctx),
    ).toThrow('Invalid live message context')
    expect(await actions.get('publishMessageContext')!(null, ctx)).toEqual({ published: false })
    expect(published.at(-1)).toBeNull()
  })

  test("a plugin's registered actions extend ITS table, but built-ins win a collision", async () => {
    registerPanelAction('sample-plugin', 'customAction', () => 'custom-result')
    registerPanelAction('sample-plugin', 'ping', () => 'shadowed!')
    const { deps } = makeDeps('s1')
    const actions = createPanelActions(deps, 'sample-plugin')
    expect(await actions.get('customAction')!(undefined, ctx)).toBe('custom-result')
    // A plugin registration must NOT shadow a built-in capability.
    expect(await actions.get('ping')!(undefined, ctx)).toBe('pong')
    clearPanelActions('sample-plugin')
  })

  test('AUTHZ: a plugin cannot invoke another plugin’s custom action', async () => {
    registerPanelAction('plugin-x', 'secretX', () => 'x-only')
    registerPanelAction('plugin-y', 'secretY', () => 'y-only')
    const { deps } = makeDeps('s1')
    // X's table sees X's action but NOT Y's, and vice versa.
    const tableX = createPanelActions(deps, 'plugin-x')
    const tableY = createPanelActions(deps, 'plugin-y')
    expect(await tableX.get('secretX')!(undefined, ctx)).toBe('x-only')
    expect(tableX.get('secretY')).toBeUndefined()
    expect(await tableY.get('secretY')!(undefined, ctx)).toBe('y-only')
    expect(tableY.get('secretX')).toBeUndefined()
    // Built-ins remain available to every plugin.
    expect(tableX.get('ping')).toBeDefined()
    expect(tableY.get('ping')).toBeDefined()
    clearPanelActions('plugin-x')
    clearPanelActions('plugin-y')
  })

  test('clearPanelActions drops a plugin’s custom actions (disable/uninstall)', async () => {
    registerPanelAction('gone', 'act', () => 'v')
    expect(createPanelActions(makeDeps('s1').deps, 'gone').get('act')).toBeDefined()
    clearPanelActions('gone')
    expect(createPanelActions(makeDeps('s1').deps, 'gone').get('act')).toBeUndefined()
  })

  test('with no pluginName, only the built-ins are available (no custom actions)', async () => {
    registerPanelAction('somePlugin', 'act', () => 'v')
    const actions = createPanelActions(makeDeps('s1').deps)
    expect(actions.get('act')).toBeUndefined()
    expect(actions.get('ping')).toBeDefined()
    clearPanelActions('somePlugin')
  })
})
