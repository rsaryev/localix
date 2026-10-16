import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openPreviewCore, type OpenPreviewCoreOptions } from './open-preview'

function options(defaultCwd?: string): OpenPreviewCoreOptions {
  return {
    userId: 'u1',
    sessionId: 'reachability',
    streamRegistry: { publish: () => {} } as never,
    defaultCwd,
  }
}

/** A loopback port nothing listens on: bound once to reserve a number, then released. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

describe('open reports a local page that does not load', () => {
  test('a stopped dev server is named as unreachable, and the tab still opens', async () => {
    const port = await closedPort()
    const result = await openPreviewCore(options(), { url: `http://127.0.0.1:${port}/` })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.unreachable).toBe('connection refused')
  })

  test('a served static file is never marked unreachable', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preview-reach-'))
    writeFileSync(path.join(dir, 'index.html'), '<h1>ok</h1>')
    const result = await openPreviewCore(options(dir), { file_path: 'index.html' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.unreachable).toBeUndefined()
  })
})

describe('file_path serves the folder, so a static page needs no server of its own', () => {
  test('relative stylesheet and script next to the page load from the same origin', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preview-assets-'))
    writeFileSync(
      path.join(dir, 'index.html'),
      '<link rel="stylesheet" href="style.css"><script src="game.js"></script><h1>2048</h1>',
    )
    writeFileSync(path.join(dir, 'style.css'), 'h1{color:red}')
    writeFileSync(path.join(dir, 'game.js'), 'window.ready=true')
    const result = await openPreviewCore(options(dir), { file_path: 'index.html' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const css = await fetch(new URL('style.css', result.url))
    const js = await fetch(new URL('game.js', result.url))
    expect(css.status).toBe(200)
    expect(await css.text()).toBe('h1{color:red}')
    expect(js.status).toBe(200)
    expect(await js.text()).toContain('window.ready=true')
  })
})
