// Runs real AppKit tab operations against local deterministic HTML, without the API or user data.
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fixtureScript } from './native-tabs-fixture.mjs'

if (process.platform !== 'darwin') {
  console.log('[native-tabs] SKIP: AppKit requires macOS')
  process.exit(0)
}
const directory = await mkdtemp(join(tmpdir(), 'localix-native-tabs-'))
const identity = `ai.localix.native-tabs-smoke.${directory.split('/').at(-1)}`
let finish
let stage = 'initial'
let expected
function armResult() {
  return new Promise((resolveResult) => {
    finish = resolveResult
  })
}
let result = armResult()
let baseUrl
const materialCss = (
  await Promise.all(
    ['theme-dark.css', 'theme-light.css', 'window-material.css', 'chrome.css'].map((name) =>
      readFile(resolve(import.meta.dir, '../../../packages/kit/styles', name), 'utf8'),
    ),
  )
).join('\n')
const tintModule = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  await readFile(resolve(import.meta.dir, '../../ui/src/shared/theme/nativeHeaderTint.ts'), 'utf8'),
)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/material.css')
      return new Response(materialCss, { headers: { 'content-type': 'text/css' } })
    if (path === '/native-header-tint.js')
      return new Response(tintModule, { headers: { 'content-type': 'text/javascript' } })
    if (path === '/native-window-fixture.js')
      return new Response(await readFile(new URL('./native-window-fixture.mjs', import.meta.url)), {
        headers: { 'content-type': 'text/javascript' },
      })
    if (path === '/trace') {
      console.log('[native-tabs]', await request.text())
      return new Response('ok')
    }
    if (path === '/result') {
      finish(await request.json())
      return new Response('ok')
    }
    if (path === '/browser')
      return new Response('<h1>Isolated browser page</h1>', {
        headers: { 'content-type': 'text/html' },
      })
    return new Response(
      `<!doctype html><html><head><title>Native tab smoke</title><link rel="stylesheet" href="/material.css"><style>body{margin:0} .app-titlebar{height:var(--titlebar-height);box-sizing:border-box;background:var(--sidebar);display:flex;align-items:center} main{height:200px;background:var(--background)}</style></head><body><div class="app-titlebar">Native workspace smoke</div><div class="app-native-tabbar-space"></div><main>Workspace content</main><script>${fixtureScript(baseUrl, stage, expected)}</script></body></html>`,
      { headers: { 'content-type': 'text/html' } },
    )
  },
})
baseUrl = `http://127.0.0.1:${server.port}`
const config = join(directory, 'tauri.json')
await writeFile(
  config,
  JSON.stringify({
    identifier: identity,
    productName: 'Localix Native Tabs Smoke',
    build: { devUrl: baseUrl, beforeDevCommand: '' },
  }),
)
function launch() {
  return spawn('bun', ['run', 'tauri', 'dev', '--no-watch', '--config', config], {
    cwd: resolve(import.meta.dir, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
}
let child = launch()
let output = ''
function capture(child) {
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-12000)
      if (chunk.toString().includes('[window-lifecycle]')) console.log(chunk.toString().trim())
    })
}
capture(child)
let timer
try {
  for (let round = 0; round < 4; round++) {
    const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
    const verdict = await Promise.race([
      result,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Native smoke timed out')), 120000)
      }),
      exited.then((code) => {
        throw new Error(`Native smoke exited ${code} before its result`)
      }),
    ])
    if (!verdict.ok) throw new Error(verdict.error)
    clearTimeout(timer)
    const code = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Clean native quit timed out')), 10000)
      }),
    ])
    clearTimeout(timer)
    if (code !== 0) throw new Error(`Native smoke quit with ${code}`)
    if (round < 3) {
      stage = ['restore', 'grouped-restore', 'hidden-restore'][round]
      expected = round === 0 ? verdict.second : verdict.group
      result = armResult()
      child = launch()
      capture(child)
    }
  }
  console.log(
    '[native-tabs] PASS: grouping, browser isolation, native +, tab close, red window close, Dock/tray reopen, minimize, fresh windows, quit and three-tab restore',
  )
} catch (error) {
  console.error(output)
  console.error('[native-tabs]', error)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {}
  }
  await server.stop(true)
  await rm(directory, { recursive: true, force: true })
  await rm(join(homedir(), 'Library', 'Application Support', identity), {
    recursive: true,
    force: true,
  })
}
