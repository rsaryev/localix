// Real AppKit panel smoke check. Isolated app identity and local HTML, no personal API or data.
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'

if (process.platform !== 'darwin') {
  console.log('[agent-island] SKIP: AppKit requires macOS')
  process.exit(0)
}
const root = await mkdtemp(join(tmpdir(), 'localix-island-smoke-'))
const identity = `ai.localix.island-smoke.${root.split('/').at(-1)}`
let finish
let done = false
let workspaceReady = false
const result = new Promise((resolveResult) => {
  finish = resolveResult
})
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/workspace-ready') {
      if (request.method === 'POST') workspaceReady = true
      return Response.json({ ready: workspaceReady })
    }
    if (path === '/result') {
      const data = await request.json()
      done = true
      finish(data)
      return new Response('ok')
    }
    if (path === '/done') return Response.json({ done })
    return new Response(
      `<html><body><script>(${fixture.toString()})().catch(error => fetch('/result', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ok:false,error:String(error)})}))</script></body></html>`,
      { headers: { 'content-type': 'text/html' } },
    )
  },
})
async function fixture() {
  const invoke = window.__TAURI__.core.invoke
  const pause = () => new Promise((resolvePause) => setTimeout(resolvePause, 100))
  const settled = async (width, height) => {
    const started = performance.now()
    let value
    do {
      value = await invoke('island_geometry')
      if (Math.abs(value.materialWidth - width) < 1 && Math.abs(value.materialHeight - height) < 1)
        return value
      await pause()
    } while (performance.now() - started < 1500)
    throw new Error('Native material did not settle: ' + JSON.stringify(value))
  }
  if (!window.__LOCALIX_ISLAND) {
    await window.__TAURI__.event.listen('localix://before-quit', ({ payload }) =>
      invoke('quit_ready', { requestId: payload.requestId }),
    )
    await invoke('set_theme', { theme: 'system' })
    await invoke('deep_link_ready')
    // The island is off by default and starts only once the person turns it on in Settings.
    await invoke('set_island_enabled', { enabled: true })
    await pause()
    await fetch('/workspace-ready', { method: 'POST' })
    while (!(await (await fetch('/done')).json()).done) await pause()
    await invoke('workspace_probe', { action: 'quit' })
    return
  }
  while (!(await (await fetch('/workspace-ready')).json()).ready) await pause()
  await invoke('island_ready')
  const compact = await invoke('island_geometry')
  if (!compact.nativePanel || !compact.nativeMaterial || Math.abs(compact.topGap) > 1)
    throw new Error(
      'Panel, shared glass, or physical display anchoring is missing: ' + JSON.stringify(compact),
    )
  if (Math.abs(compact.materialHeight - compact.compactHeight) > 1)
    throw new Error('Compact glass does not match the resting island')
  // The island uses the same appearance-specific vibrancy material as the workspace.
  if (!['liquid-glass', 'vibrancy'].includes(compact.materialKind))
    throw new Error('Unknown island material: ' + compact.materialKind)
  if (compact.materialAppearance !== compact.appearance)
    throw new Error(
      'System appearance differs between panel and material: ' + JSON.stringify(compact),
    )
  await invoke('island_set_layout', {
    layout: {
      expanded: true,
      height: 128,
      durationMs: 260,
      radius: 24,
      mode: 'waiting',
    },
  })
  const expanded = await settled(580, 128)
  // A request that opens by itself must never take the keyboard: the person may be typing elsewhere.
  if (expanded.keyWindow) throw new Error('Opening the island took the keyboard')
  if (
    Math.abs(expanded.materialHeight - 128) > 1 ||
    Math.abs(expanded.materialWidth - 580) > 1 ||
    Math.abs(expanded.topGap) > 1
  )
    throw new Error(
      'Expanding the request moved the native panel or lost glass geometry: ' +
        JSON.stringify(expanded),
    )
  for (const theme of ['light', 'dark', 'light']) {
    await invoke('set_theme', { theme, materialTheme: theme })
    const themed = await settled(580, 128)
    const expected = theme === 'light' ? 'NSAppearanceNameAqua' : 'NSAppearanceNameDarkAqua'
    if (themed.materialAppearance !== expected)
      throw new Error('Theme switch lost the material appearance: ' + JSON.stringify(themed))
  }
  await invoke('island_set_layout', {
    layout: {
      expanded: false,
      height: 128,
      durationMs: 0,
      radius: 24,
      mode: 'waiting',
    },
  })
  const folded = await invoke('island_geometry')
  if (Math.abs(folded.materialWidth - compact.compactWidth) > 1)
    throw new Error('Folding did not restore the compact material')
  // Nothing working or waiting: the glass disappears and the island is click-through.
  await invoke('island_set_layout', {
    layout: {
      expanded: false,
      durationMs: 0,
      radius: 24,
      mode: 'hidden',
    },
  })
  const quiet = await invoke('island_geometry')
  const quietWidth = quiet.notchWidth > 0 ? quiet.notchWidth : quiet.compactWidth
  if (quiet.materialAlpha !== 0 || Math.abs(quiet.materialWidth - quietWidth) > 1)
    throw new Error('A quiet island still shows its glass: ' + JSON.stringify(quiet))
  await invoke('island_set_layout', {
    layout: { expanded: false, durationMs: 0, radius: 24, mode: 'working' },
  })
  const active = await invoke('island_geometry')
  if (!(active.materialAlpha > 0) || Math.abs(active.materialWidth - compact.compactWidth) > 1)
    throw new Error('Activity did not bring the resting glass back: ' + JSON.stringify(active))
  await fetch('/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, compact, expanded, folded, quiet, active }),
  })
}
const config = join(root, 'tauri.json')
await writeFile(
  config,
  JSON.stringify({
    identifier: identity,
    productName: 'Localix Island Smoke',
    build: { devUrl: `http://127.0.0.1:${server.port}`, beforeDevCommand: '' },
  }),
)
const child = spawn('bun', ['run', 'tauri', 'dev', '--no-watch', '--config', config], {
  cwd: resolve(import.meta.dir, '..'),
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (chunk) => {
    output = (output + chunk.toString()).slice(-12000)
  })
let timer
try {
  const verdict = await Promise.race([
    result,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Native island smoke timed out')), 120000)
    }),
    new Promise((_, reject) =>
      child.once('exit', (code) => {
        if (!done) reject(new Error(`Native island exited ${code}`))
      }),
    ),
  ])
  if (!verdict.ok) throw new Error(verdict.error)
  console.log(
    '[agent-island] PASS: NSPanel, shared glass, display anchoring, expansion without the keyboard, folding, light and quiet rest',
  )
  console.log(JSON.stringify(verdict))
} catch (error) {
  console.error(output)
  console.error(error)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  try {
    if (child.pid) process.kill(-child.pid, 'SIGTERM')
  } catch {}
  await server.stop(true)
  await rm(root, { recursive: true, force: true })
  await rm(join(homedir(), 'Library', 'Application Support', identity), {
    recursive: true,
    force: true,
  })
}
