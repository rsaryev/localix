import { afterEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeProjects, projectIndex } from './indexing/projects'
import { createGraphRoutes } from './routes'
import { buildSnapshot } from './snapshot'

const roots: string[] = []
afterEach(() => {
  closeProjects()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function project() {
  const root = mkdtempSync(join(tmpdir(), 'code-graph-snapshot-'))
  roots.push(root)
  writeFileSync(join(root, 'a.ts'), 'export function a() {}')
  return { root, dataDir: join(root, '.cache') }
}

/**
 * Every poll older than 10 s started a walk and a stat of every source file, so an open, idle map
 * re-walked the project several times a minute to learn that nothing changed. A tab that hears
 * file changes says so, and its polls only keep a slow backstop check.
 */
test('a live tab’s poll keeps only a backstop freshness check', async () => {
  const { root, dataDir } = project()
  const index = projectIndex(dataDir, root)
  const touch = spyOn(index, 'touch')
  await buildSnapshot(index, { live: true })
  expect(touch).toHaveBeenLastCalledWith(5 * 60_000)
  await buildSnapshot(index, {})
  expect(touch).toHaveBeenLastCalledWith(10_000)
  const routes = createGraphRoutes(dataDir)
  await routes.request('/view?live=1', {}, { cwd: root })
  expect(touch).toHaveBeenLastCalledWith(5 * 60_000)
})

test('a change the tab heard starts a refresh that sees the new file', async () => {
  const { root, dataDir } = project()
  const index = projectIndex(dataDir, root)
  await index.refresh()
  expect(index.current?.stats.symbols).toBe(1)
  writeFileSync(join(root, 'b.ts'), 'export function b() {}')
  const routes = createGraphRoutes(dataDir)
  const response = await routes.request(
    '/changed',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    { cwd: root },
  )
  expect(response.status).toBe(200)
  await index.refresh()
  expect(index.current?.stats.symbols).toBe(2)
})
