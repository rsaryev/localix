import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
const CHESS = { miniApp: 'tile-game', name: 'Tile game', projectDir: '/h/.localix/apps/tile-game' }

beforeAll(() => {
  teardown = registerDom()
})

afterAll(async () => {
  await teardown()
})

afterEach(() => {
  delete window.__LOCALIX_APP
  delete window.webkit
  localStorage.clear()
  window.location.hash = ''
  delete document.documentElement.dataset.desktop
  delete document.documentElement.dataset.standaloneApp
})

describe('standaloneApp', () => {
  test('the workspace is not a standalone app', async () => {
    const { standaloneApp } = await import('./standaloneApp')
    expect(standaloneApp()).toBeNull()
  })

  test('a malformed mini app name is not a standalone app', async () => {
    const { standaloneApp } = await import('./standaloneApp')
    window.__LOCALIX_APP = { ...CHESS, miniApp: '../kanban' }
    expect(standaloneApp()).toBeNull()
  })

  test('a window without its project folder is not a standalone app', async () => {
    const { standaloneApp } = await import('./standaloneApp')
    window.__LOCALIX_APP = { ...CHESS, projectDir: '' }
    expect(standaloneApp()).toBeNull()
  })

  test('an app window names its mini app and title', async () => {
    const { standaloneApp } = await import('./standaloneApp')
    window.__LOCALIX_APP = {
      miniApp: 'puzzle-grid',
      name: '2048',
      projectDir: '/h/.localix/apps/puzzle-grid',
    }
    expect(standaloneApp()).toEqual({
      miniApp: 'puzzle-grid',
      name: '2048',
      projectDir: '/h/.localix/apps/puzzle-grid',
    })
  })
})

describe('applyStandaloneAppStartRoute', () => {
  test('starts on the remembered conversation instead of the home page', async () => {
    const { applyStandaloneAppStartRoute, rememberStandaloneAppSession } =
      await import('./standaloneApp')
    window.__LOCALIX_APP = CHESS
    rememberStandaloneAppSession('tile-game', 'abc_123')
    applyStandaloneAppStartRoute()
    expect(window.location.hash).toBe('#/chat/abc_123')
  })

  test('leaves a route the window already has, and the workspace, alone', async () => {
    const { applyStandaloneAppStartRoute, rememberStandaloneAppSession } =
      await import('./standaloneApp')
    rememberStandaloneAppSession('tile-game', 'abc_123')
    applyStandaloneAppStartRoute()
    expect(window.location.hash).toBe('')
    window.__LOCALIX_APP = CHESS
    window.location.hash = '#/chat/other'
    applyStandaloneAppStartRoute()
    expect(window.location.hash).toBe('#/chat/other')
  })
})

describe('stampStandaloneAppDataset', () => {
  test('marks an app page for the macOS glass styles only', async () => {
    const { stampStandaloneAppDataset } = await import('./standaloneApp')
    stampStandaloneAppDataset()
    expect(document.documentElement.dataset.desktop).toBeUndefined()
    window.__LOCALIX_APP = CHESS
    stampStandaloneAppDataset()
    expect(document.documentElement.dataset.desktop).toBe('true')
    expect(document.documentElement.dataset.standaloneApp).toBe('true')
  })
})

describe('postToStandaloneApp', () => {
  test('sends JSON to the native window, and is silent without one', async () => {
    const { postToStandaloneApp } = await import('./standaloneApp')
    expect(() => postToStandaloneApp({ type: 'session', id: 'abc' })).not.toThrow()
    const sent: string[] = []
    window.webkit = { messageHandlers: { localixApp: { postMessage: (body) => sent.push(body) } } }
    postToStandaloneApp({ type: 'theme', dark: true })
    expect(sent.map((body) => JSON.parse(body))).toEqual([{ type: 'theme', dark: true }])
  })
})
