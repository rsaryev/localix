import { registerDom } from '@localixai/kit/testing/dom'
import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { createHashRouter } from 'react-router'
import { installLocationLedger } from './locationLedger'
import { loadLastWorkspace, loadRememberedActiveSession } from './persistence'

type HappyWindow = { happyDOM: { setURL(url: string): void } }
let teardown: () => Promise<void>
let originalUrl = ''
beforeAll(() => {
  teardown = registerDom()
  originalUrl = window.location.href
  // The hash history resolves against the document URL; `about:blank` has no base.
  ;(window as unknown as HappyWindow).happyDOM.setURL('http://localhost/')
})
afterAll(async () => {
  ;(window as unknown as HappyWindow).happyDOM.setURL(originalUrl)
  await teardown()
})
afterEach(() => {
  localStorage.clear()
  delete window.__LOCALIX_WORKSPACE
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
  window.history.replaceState(null, '', '#/')
})

function nativeWorkspace(): string[] {
  const routes: string[] = []
  window.__LOCALIX_WORKSPACE = { id: 'main', route: null }
  ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: async (command: string, args?: { route?: string }) => {
        if (command === 'workspace_location' && args?.route) routes.push(args.route)
      },
    },
  }
  return routes
}

test('router navigations reach the shell so a relaunch reopens the open conversation', async () => {
  const routes = nativeWorkspace()
  // A folder open writes the hash directly; the shell recorded only this bare scope before.
  window.history.replaceState(null, '', '#/project/PRJ-6')
  const router = createHashRouter([{ path: '*', element: null }])
  const uninstall = installLocationLedger(router)
  // Selecting a chat in another project goes through history.pushState: no `hashchange`.
  await router.navigate('/project/PRJ-1/LOCALIX-136')
  await router.navigate('/project/PRJ-1/LOCALIX-136', { replace: true })
  uninstall()
  router.dispose()
  expect(routes).toEqual(['/project/PRJ-6', '/project/PRJ-1/LOCALIX-136'])
  // The browser records follow the same navigation: the launch pair and the project's chat.
  expect(loadLastWorkspace()).toEqual({ projectId: 'PRJ-1', sessionId: 'LOCALIX-136' })
  expect(loadRememberedActiveSession('PRJ-1')).toBe('LOCALIX-136')
})

test('only an open chat is recorded: a bare project or home route leaves the records alone', async () => {
  const router = createHashRouter([{ path: '*', element: null }])
  const uninstall = installLocationLedger(router)
  await router.navigate('/project/PRJ-1/LOCALIX-1/files')
  await router.navigate('/project/PRJ-6')
  await router.navigate('/')
  uninstall()
  router.dispose()
  expect(loadLastWorkspace()).toEqual({ projectId: 'PRJ-1', sessionId: 'LOCALIX-1' })
})

test('the query never reaches the shell and uninstall stops reporting', async () => {
  const routes = nativeWorkspace()
  const router = createHashRouter([{ path: '*', element: null }])
  const uninstall = installLocationLedger(router)
  await router.navigate('/project/PRJ-2/LOCALIX-9?prompt=hello')
  uninstall()
  await router.navigate('/project/PRJ-3')
  router.dispose()
  expect(routes).toEqual(['/', '/project/PRJ-2/LOCALIX-9'])
})

test('a browser tab without a native workspace reports nothing to the shell', () => {
  const router = createHashRouter([{ path: '*', element: null }])
  let invoked = false
  ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: { invoke: async () => void (invoked = true) },
  }
  installLocationLedger(router)()
  router.dispose()
  expect(invoked).toBe(false)
})
