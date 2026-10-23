import { afterEach, describe, expect, test } from 'bun:test'

import {
  bindMiniAppUiRuntime,
  miniAppComposer,
  miniAppExternal,
  miniAppFiles,
  miniAppNavigation,
  miniAppRealtime,
  miniAppResources,
  miniAppSessions,
  miniAppSecrets,
  miniAppTerminal,
  miniAppWorkspace,
  type MiniAppUiRuntime,
} from './runtime'

/** What a host with the completion route off would hand back: nothing to show, no key consumed. */
const inertTextInputCompletion = () => ({
  suggestion: '',
  accept: () => false,
  dismiss: () => false,
  request: () => false,
  handleKeyDown: () => false,
  handleCompositionStart: () => undefined,
  handleCompositionEnd: () => undefined,
})

let unbind: (() => void) | undefined
afterEach(() => {
  unbind?.()
  unbind = undefined
})

function bind(overrides: Partial<MiniAppUiRuntime> = {}) {
  const runtime: MiniAppUiRuntime = {
    workspace: {
      openWorkItem: () => undefined,
      openFile: () => undefined,
      openDiff: () => undefined,
      openPreview: () => Promise.resolve(),
      closeWorkItems: () => undefined,
      focusWorkItem: () => undefined,
      openSidebarSection: () => undefined,
      getSnapshot: () => ({ items: {}, focusedId: null }),
      subscribe: () => () => undefined,
    },
    composer: { insert: () => undefined },
    terminal: {
      openPanel: () => undefined,
      paste: () => undefined,
      openJob: () => undefined,
      spawnCommand: async () => ({ terminalId: 'terminal' }),
    },
    files: {
      announceReloaded: () => undefined,
      saveBlob: () => undefined,
      download: async () => undefined,
      pickFiles: async () => [],
      bindingsFromFiles: async () => [],
      droppedPaths: async () => null,
      read: async (_sessionId, path) => ({
        path,
        content: '',
        bytes: 0,
        truncated: false,
      }),
      watchWorkspace: () => () => undefined,
    },
    secrets: { listReferences: async () => [], set: async () => undefined },
    realtime: {
      onFrame: () => () => undefined,
      onReconnect: () => () => undefined,
      onDisconnect: () => () => undefined,
      request: async () => undefined,
    },
    sessions: {
      list: () => [],
      subscribe: () => () => undefined,
      stop: async () => undefined,
      interact: async () => undefined,
      importConversation: async () => ({ id: 'imported', projectId: 'PRJ-1' }),
      openTranscript: () => undefined,
    },
    navigation: { revealSession: () => undefined, openBinding: () => false },
    resources: {
      browse: async () => ({
        parent: null,
        nodes: [],
        notices: [],
        total: 0,
        truncated: false,
      }),
    },
    projects: {
      resolvePath: async () => ({ id: 'project' }),
      refresh: async () => undefined,
    },
    editor: {
      predictionEnabled: () => true,
      subscribe: () => () => undefined,
      predictNextEdit: async () => ({ outcome: 'empty', edits: null }),
    },
    completion: { useTextInput: inertTextInputCompletion },
    clipboard: { writeText: async () => true },
    external: { open: () => undefined },
    ...overrides,
  }
  unbind = bindMiniAppUiRuntime(runtime)
  return runtime
}

describe('mini app UI runtime capabilities', () => {
  test('delegates browser files as host-native bindings without exposing host storage', async () => {
    const file = new File(['hello'], 'notes.md', { type: 'text/markdown' })
    const binding = {
      kind: 'context' as const,
      source: 'drag' as const,
      target: {
        kind: 'file' as const,
        token: '@/workspace/notes.md',
        label: 'notes.md',
        attributes: { path: '/workspace/notes.md' },
      },
    }
    bind({
      files: {
        announceReloaded: () => undefined,
        saveBlob: () => undefined,
        download: async () => undefined,
        pickFiles: async () => [],
        bindingsFromFiles: async (files) => (files[0] === file ? [binding] : []),
        droppedPaths: async (files) =>
          files[0] === file ? [{ path: '/workspace/notes.md', isDir: false }] : null,
        read: async (_sessionId, path) => ({
          path,
          content: '',
          bytes: 0,
          truncated: false,
        }),
        watchWorkspace: () => () => undefined,
      },
    })

    expect(await miniAppFiles.bindingsFromFiles([file])).toEqual([binding])
    // The side-effect-free door: the real paths, nothing opened or uploaded.
    expect(await miniAppFiles.droppedPaths([file])).toEqual([
      { path: '/workspace/notes.md', isDir: false },
    ])
  })

  test('delegates agnostic workbench actions, each naming the chat it acts for', () => {
    const opened: Array<[string, string | null]> = []
    const inserts: Array<[string, string]> = []
    const terminals: Array<[string, string]> = []
    bind({
      workspace: {
        openWorkItem: (request) => opened.push([request.id, request.scope]),
        openFile: () => undefined,
        openDiff: () => undefined,
        openPreview: () => Promise.resolve(),
        closeWorkItems: () => undefined,
        focusWorkItem: () => undefined,
        openSidebarSection: () => undefined,
        getSnapshot: () => ({ items: {}, focusedId: null }),
        subscribe: () => () => undefined,
      },
      composer: { insert: (request) => inserts.push([request.text ?? '', request.sessionId]) },
      terminal: {
        openPanel: () => undefined,
        paste: () => undefined,
        openJob: (request) => terminals.push([request.terminalId, request.sessionId]),
        spawnCommand: async () => ({ terminalId: 'spawned-terminal' }),
      },
    })

    miniAppWorkspace.openWorkItem({
      workKind: 'example',
      id: 'item-1',
      title: 'Example',
      scope: 'session-1',
    })
    miniAppComposer.insert({ text: 'Ask about this', sessionId: 'session-1' })
    miniAppTerminal.openJob({ terminalId: 'terminal-1', sessionId: 'session-1' })

    expect(opened).toEqual([['item-1', 'session-1']])
    expect(inserts).toEqual([['Ask about this', 'session-1']])
    expect(terminals).toEqual([['terminal-1', 'session-1']])
    // There is no "active session" to read: a mini app acts for the chat it belongs to.
    expect('activeId' in miniAppSessions).toBe(false)
    expect('activeScope' in miniAppWorkspace.getSnapshot()).toBe(false)
  })

  test('rejects downloads outside mini app RPC routes', () => {
    bind()
    expect(() => miniAppFiles.download('https://example.com/file', 'file.txt')).toThrow()
    expect(() => miniAppFiles.download('/internal/file', 'file.txt')).toThrow()
  })

  test('delegates validated external URLs to the host', async () => {
    const opened: string[] = []
    bind({
      external: {
        open: (url) => {
          opened.push(url)
        },
      },
    })
    await miniAppExternal.open('https://example.com/book?q=reader')
    await miniAppExternal.open('tel:+35799123456')
    expect(opened).toEqual(['https://example.com/book?q=reader', 'tel:+35799123456'])
    expect(() => miniAppExternal.open('javascript:alert(1)')).toThrow()
    expect(() => miniAppExternal.open('tel:')).toThrow()
  })

  test('delegates opaque context bindings to the host navigation registry', async () => {
    const opened: string[] = []
    bind({
      navigation: {
        revealSession: () => undefined,
        openBinding: (binding) => {
          opened.push(binding.target.token)
          return true
        },
      },
    })

    expect(
      await miniAppNavigation.openBinding(
        {
          kind: 'context',
          source: 'active-tab',
          target: {
            kind: 'resource',
            token: '@resource:localix://resource/example/item/42',
            label: 'Mini app tab',
            uri: 'localix://resource/example/item/42',
            attributes: { providerView: 'timeline' },
          },
        },
        'session-1',
      ),
    ).toBe(true)
    expect(opened).toEqual(['@resource:localix://resource/example/item/42'])
  })

  test('delegates host services without exposing their clients', async () => {
    const commands: string[] = []
    const written: string[] = []
    bind({
      terminal: {
        openPanel: () => undefined,
        paste: () => undefined,
        openJob: () => undefined,
        spawnCommand: async (request) => {
          commands.push(request.command)
          return { terminalId: 'terminal-2' }
        },
      },
      secrets: {
        listReferences: async () => [
          { key: 'TOKEN', label: 'Token', reference: '${secret:TOKEN}' },
        ],
        set: async ({ key }) => {
          written.push(key)
        },
      },
    })

    expect(
      await miniAppTerminal.spawnCommand({
        command: 'echo ok',
        sessionId: 'session-1',
      }),
    ).toEqual({
      terminalId: 'terminal-2',
    })
    expect(await miniAppSecrets.listReferences()).toHaveLength(1)
    await miniAppSecrets.set({ key: 'TOKEN', value: 'opaque' })
    expect(commands).toEqual(['echo ok'])
    expect(written).toEqual(['TOKEN'])
  })

  test('browses provider-owned resources through an opaque hierarchy', async () => {
    bind({
      resources: {
        browse: async (partial) => ({
          parent: null,
          nodes: [
            {
              uri: `localix://resource/example/${partial}`,
              label: 'Item',
              hasChildren: false,
            },
          ],
          notices: [],
          total: 1,
          truncated: false,
        }),
      },
    })
    const result = await miniAppResources.browse('query', 'session-1')
    expect(result.nodes[0]?.uri).toBe('localix://resource/example/query')
  })

  test('reserves core realtime tags while delegating mini app frames', () => {
    const tags: string[] = []
    bind({
      realtime: {
        onFrame: (tag) => {
          tags.push(tag)
          return () => undefined
        },
        onReconnect: () => () => undefined,
        onDisconnect: () => () => undefined,
        request: async () => undefined,
      },
    })

    miniAppRealtime.onFrame('m', () => undefined)()
    expect(tags).toEqual(['m'])
    expect(() => miniAppRealtime.onFrame('s', () => undefined)).toThrow()
    // `n` is the notification journal; the browser guard used to forget it.
    expect(() => miniAppRealtime.onFrame('n', () => undefined)).toThrow()
    expect(() => miniAppRealtime.onFrame('wide', () => undefined)).toThrow()
  })

  test('ending a binding restores the one it shadowed instead of leaving nothing bound', () => {
    const focused: string[] = []
    const host = bind({
      workspace: {
        ...({} as MiniAppUiRuntime['workspace']),
        focusWorkItem: (id) => void focused.push(`host:${id}`),
      },
    })
    const unbindDouble = bindMiniAppUiRuntime({
      ...host,
      workspace: { ...host.workspace, focusWorkItem: (id) => void focused.push(`double:${id}`) },
    })
    miniAppWorkspace.focusWorkItem('a')
    unbindDouble()
    miniAppWorkspace.focusWorkItem('b')
    expect(focused).toEqual(['double:a', 'host:b'])
  })
})
