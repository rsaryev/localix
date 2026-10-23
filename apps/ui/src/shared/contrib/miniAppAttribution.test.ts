import { afterEach, describe, expect, test } from 'bun:test'

import { attributeMiniAppCaller, miniAppLabel, setMiniAppSources } from './miniAppAttribution'

const API = 'http://127.0.0.1:43110'
const acme = { pluginName: 'acme', base: `${API}/rpc/plugins/acme/ui/` }
const acmeTools = {
  pluginName: 'acme-tools',
  base: `${API}/rpc/plugins/acme-tools/ui/`,
}
const known = [acme, acmeTools]

// Chrome / the Vite dev server: `at fn (URL:line:col)`, with the host's frames first.
const V8_STACK = [
  'Error',
  '    at callerStack (http://localhost:1420/src/shared/contrib/miniAppToast.ts?t=1727000000:41:61)',
  '    at sourceOf (http://localhost:1420/src/shared/contrib/miniAppToast.ts:48:48)',
  '    at Object.error (http://localhost:1420/node_modules/.vite/deps/@localixai_mini-app-sdk_ui.js?v=9f1c2e:1203:31)',
  `    at onSelect (${API}/rpc/plugins/acme/ui/chunks/ConnectionMenu-3f9a1b.js:88:13)`,
  '    at HTMLUnknownElement.callCallback2 (http://localhost:1420/node_modules/.vite/deps/react-dom_client.js?v=9f1c2e:3674:22)',
].join('\n')

// The desktop shell's WebKit (JavaScriptCore): `fn@URL:line:col`, no header line, and the host
// bundled under the app's own scheme.
const JSC_STACK = [
  'callerStack@tauri://localhost/assets/index-a1b2c3.js:4211:52',
  'sourceOf@tauri://localhost/assets/index-a1b2c3.js:4211:120',
  'error@tauri://localhost/assets/index-a1b2c3.js:9120:40',
  `onSelect@${API}/rpc/plugins/acme-tools/ui/entry.js?v=r7:12:88`,
  'dispatchEvent@[native code]',
].join('\n')

afterEach(() => setMiniAppSources([], new Map()))

describe('attributeMiniAppCaller', () => {
  test('names the plugin whose chunk made the call in a V8 stack', () => {
    expect(attributeMiniAppCaller(V8_STACK, known)?.pluginName).toBe('acme')
  })

  test('names the plugin whose entry made the call in a JavaScriptCore stack', () => {
    expect(attributeMiniAppCaller(JSC_STACK, known)?.pluginName).toBe('acme-tools')
  })

  test('reads anonymous frames of both dialects', () => {
    expect(attributeMiniAppCaller(`    at ${acme.base}entry.js?v=r1:3:9`, known)).toMatchObject({
      pluginName: 'acme',
    })
    expect(attributeMiniAppCaller(`@${acmeTools.base}entry.js?v=r1:3:9`, known)).toMatchObject({
      pluginName: 'acme-tools',
    })
  })

  // A plugin named after another's prefix must not claim its frames — the base ends in `/ui/`.
  test('a plugin whose name prefixes another is not blamed for its frames', () => {
    expect(attributeMiniAppCaller(JSC_STACK, [acme])).toBeNull()
  })

  test("a call from the host's own code is nobody's", () => {
    const host = V8_STACK.split('\n').slice(0, 4).join('\n')
    expect(attributeMiniAppCaller(host, known)).toBeNull()
    expect(attributeMiniAppCaller('', known)).toBeNull()
  })

  test('reads the registered sources and labels the plugin by its display name', () => {
    setMiniAppSources(known, new Map([['acme', 'Acme']]))
    expect(attributeMiniAppCaller(V8_STACK)).toEqual({ pluginName: 'acme', label: 'Acme' })
    // No display name declared: the name itself is what a person reads.
    expect(attributeMiniAppCaller(JSC_STACK)).toEqual({
      pluginName: 'acme-tools',
      label: 'acme-tools',
    })
  })

  test('nothing registered attributes nothing', () => {
    expect(attributeMiniAppCaller(V8_STACK)).toBeNull()
  })
})

describe('miniAppLabel', () => {
  test('falls back to the name for a plugin the host does not know', () => {
    setMiniAppSources([], new Map([['webhooks', 'Webhooks']]))
    expect(miniAppLabel('webhooks')).toBe('Webhooks')
    expect(miniAppLabel('unknown')).toBe('unknown')
  })
})
