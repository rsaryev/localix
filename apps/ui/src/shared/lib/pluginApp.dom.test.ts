import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
const CHESS = { plugin: 'tile-game', name: 'Tile game', projectDir: '/h/.localix/apps/tile-game' }

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
  delete document.documentElement.dataset.pluginApp
})

describe('pluginApp', () => {
  test('the workspace is not a plugin app', async () => {
    const { pluginApp } = await import('./pluginApp')
    expect(pluginApp()).toBeNull()
  })

  test('a malformed plugin name is not a plugin app', async () => {
    const { pluginApp } = await import('./pluginApp')
    window.__LOCALIX_APP = { ...CHESS, plugin: '../kanban' }
    expect(pluginApp()).toBeNull()
  })

  test('a window without its project folder is not a plugin app', async () => {
    const { pluginApp } = await import('./pluginApp')
    window.__LOCALIX_APP = { ...CHESS, projectDir: '' }
    expect(pluginApp()).toBeNull()
  })

  test('an app window names its plugin and title', async () => {
    const { pluginApp } = await import('./pluginApp')
    window.__LOCALIX_APP = {
      plugin: 'puzzle-grid',
      name: '2048',
      projectDir: '/h/.localix/apps/puzzle-grid',
    }
    expect(pluginApp()).toEqual({
      plugin: 'puzzle-grid',
      name: '2048',
      projectDir: '/h/.localix/apps/puzzle-grid',
    })
  })
})

describe('applyPluginAppStartRoute', () => {
  test('starts on the remembered conversation instead of the home page', async () => {
    const { applyPluginAppStartRoute, rememberPluginAppSession } = await import('./pluginApp')
    window.__LOCALIX_APP = CHESS
    rememberPluginAppSession('tile-game', 'abc_123')
    applyPluginAppStartRoute()
    expect(window.location.hash).toBe('#/chat/abc_123')
  })

  test('leaves a route the window already has, and the workspace, alone', async () => {
    const { applyPluginAppStartRoute, rememberPluginAppSession } = await import('./pluginApp')
    rememberPluginAppSession('tile-game', 'abc_123')
    applyPluginAppStartRoute()
    expect(window.location.hash).toBe('')
    window.__LOCALIX_APP = CHESS
    window.location.hash = '#/chat/other'
    applyPluginAppStartRoute()
    expect(window.location.hash).toBe('#/chat/other')
  })
})

describe('stampPluginAppDataset', () => {
  test('marks an app page for the macOS glass styles only', async () => {
    const { stampPluginAppDataset } = await import('./pluginApp')
    stampPluginAppDataset()
    expect(document.documentElement.dataset.desktop).toBeUndefined()
    window.__LOCALIX_APP = CHESS
    stampPluginAppDataset()
    expect(document.documentElement.dataset.desktop).toBe('true')
    expect(document.documentElement.dataset.pluginApp).toBe('true')
  })
})

describe('postToPluginApp', () => {
  test('sends JSON to the native window, and is silent without one', async () => {
    const { postToPluginApp } = await import('./pluginApp')
    expect(() => postToPluginApp({ type: 'session', id: 'abc' })).not.toThrow()
    const sent: string[] = []
    window.webkit = { messageHandlers: { localixApp: { postMessage: (body) => sent.push(body) } } }
    postToPluginApp({ type: 'theme', dark: true })
    expect(sent.map((body) => JSON.parse(body))).toEqual([{ type: 'theme', dark: true }])
  })
})
