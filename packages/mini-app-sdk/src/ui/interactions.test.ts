import { afterEach, describe, expect, test } from 'bun:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { copyText, useCopied } from './interactions'
import { bindMiniAppUiToast, type MiniAppToast } from './notifications'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from './runtime'

let unbind: (() => void) | undefined
afterEach(() => {
  unbind?.()
  unbind = undefined
})

function setupClipboard(writeText: (text: string) => Promise<boolean>) {
  const calls: Array<{ level: string; message: string }> = []
  const method = (level: string) => (message: string) => {
    calls.push({ level, message })
    return calls.length
  }
  bindMiniAppUiToast(
    Object.assign(method('default'), {
      success: method('success'),
      error: method('error'),
      info: method('info'),
      warning: method('warning'),
      message: method('message'),
    }) as MiniAppToast,
  )
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
    completion: {
      useTextInput: () => ({
        suggestion: '',
        accept: () => false,
        dismiss: () => false,
        request: () => false,
        handleKeyDown: () => false,
        handleCompositionStart: () => undefined,
        handleCompositionEnd: () => undefined,
      }),
    },
    clipboard: { writeText },
    external: { open: () => undefined },
  }
  unbind = bindMiniAppUiRuntime(runtime)
  return calls
}

describe('mini app clipboard interaction', () => {
  test('a confirmed write posts no Event Center row', async () => {
    const written: string[] = []
    const calls = setupClipboard(async (text) => {
      written.push(text)
      return true
    })

    expect(await copyText('SELECT 1', 'SQL')).toBe(true)
    expect(written).toEqual(['SELECT 1'])
    expect(calls).toEqual([])
  })

  test('reports unavailable and rejected writes as "Could not copy …"', async () => {
    const unavailable = setupClipboard(async () => false)
    expect(await copyText('value', 'SQL')).toBe(false)
    expect(unavailable).toEqual([{ level: 'error', message: 'Could not copy SQL' }])

    const rejected = setupClipboard(async () => {
      throw new Error('denied')
    })
    expect(await copyText('value', 'Object name')).toBe(false)
    expect(rejected).toEqual([{ level: 'error', message: 'Could not copy object name' }])
  })
})

/**
 * `useCopied` is the copy affordance behind every copy button in the app — code
 * blocks, tool IO, command cards, message actions, the file viewer. It used to
 * `return` on a false and swallow a rejection, so a refused clipboard was
 * indistinguishable from a click that never registered: the icon simply never
 * became a checkmark.
 *
 * Rendered through `react-dom/server` so the hook runs for real without pulling a
 * DOM into this package; `copy` is captured during render and driven afterwards,
 * which is enough because every failure path returns before touching state.
 */
function captureCopy(): (text: string) => Promise<void> {
  let copy: ((text: string) => Promise<void>) | undefined
  function Probe() {
    copy = useCopied(1000).copy
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  if (!copy) throw new Error('useCopied did not expose a copy callback')
  return copy
}

describe('shared copy affordance', () => {
  test('says so when the clipboard reports it did not write', async () => {
    const calls = setupClipboard(async () => false)
    await captureCopy()('value')
    expect(calls).toEqual([{ level: 'error', message: 'Could not copy to the clipboard' }])
  })

  test('says so when the clipboard rejects, instead of a silent no-op', async () => {
    const calls = setupClipboard(async () => {
      throw new Error('Write permission denied')
    })
    await captureCopy()('value')
    expect(calls).toEqual([{ level: 'error', message: 'Could not copy to the clipboard' }])
  })

  test('stays quiet on a copy the platform accepted', async () => {
    const written: string[] = []
    const calls = setupClipboard(async (text) => {
      written.push(text)
      return true
    })
    await captureCopy()('SELECT 1')
    expect(written).toEqual(['SELECT 1'])
    expect(calls).toEqual([])
  })
})
