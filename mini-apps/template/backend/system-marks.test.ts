import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { SYSTEM_MARKS_LIMIT, systemMarksSchema } from '../shared/system-marks'
import { register } from './index'
import { createTemplateRoutes } from './routes'
import { createSystemMarks } from './system-marks'
import type { SystemReader } from './system'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function dataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'system-marks-'))
  dirs.push(dir)
  return dir
}
const sample = { cpu: { usagePercent: 12.5 }, memory: { usedBytes: 4096 } }
const read = (() => sample) as unknown as SystemReader

test('a mark keeps its note and the sample it was taken with, and survives a new instance', async () => {
  const dir = dataDir()
  const at = new Date('2026-09-25T08:00:00.000Z')
  await createSystemMarks(dir, read, () => at).add('before the build')
  const again = await createSystemMarks(dir, read).list()
  expect(again.marks).toMatchObject([
    { note: 'before the build', at: at.toISOString(), cpuPercent: 12.5, memoryUsedBytes: 4096 },
  ])
  expect(
    systemMarksSchema.parse(JSON.parse(readFileSync(join(dir, 'marks.json'), 'utf8'))),
  ).toEqual(again)
})

// The host calls register(ctx) more than once, so two callers share one file. A queue per
// instance would interleave their read-modify-writes and lose marks.
test('concurrent adds from separate callers lose nothing, and the oldest go past the limit', async () => {
  const dir = dataDir()
  const a = createSystemMarks(dir, read)
  const b = createSystemMarks(dir, read)
  await Promise.all(
    Array.from({ length: SYSTEM_MARKS_LIMIT + 5 }, (_, i) => (i % 2 ? a : b).add(`mark ${i}`)),
  )
  const { marks } = await a.list()
  expect(marks).toHaveLength(SYSTEM_MARKS_LIMIT)
  expect(marks.at(-1)?.note).toBe(`mark ${SYSTEM_MARKS_LIMIT + 4}`)
  expect(new Set(marks.map((mark) => mark.id)).size).toBe(SYSTEM_MARKS_LIMIT)
})

test('writes land atomically and leave no temp file beside the store', async () => {
  // `openJsonStore` used one fixed `<file>.<pid>.tmp` for every write and never removed it on
  // failure; the SDK's `atomicWriteFile` names each temp uniquely and cleans it up.
  const dir = dataDir()
  const marks = createSystemMarks(dir, read)
  await Promise.all(['a', 'b', 'c'].map((note) => marks.add(note)))
  expect(readdirSync(dir)).toEqual(['marks.json'])
})

test('an unreadable file reads as empty instead of throwing at every poll', async () => {
  const dir = dataDir()
  writeFileSync(join(dir, 'marks.json'), '{"marks": [{"note": 42}]')
  expect(await createSystemMarks(dir, read).list()).toEqual({ marks: [] })
})

test('the routes validate a note, answer with the new state, and delete by id', async () => {
  const marks = createSystemMarks(dataDir(), read)
  const app = createTemplateRoutes({ read, processes: { read: async () => ({}) } as never, marks })
  const post = (body: unknown, type = 'application/json') =>
    app.request('/marks', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': type },
    })
  const refused = await post({ note: '   ' })
  expect(refused.status).toBe(400)
  expect(await refused.text()).toContain('Write a note for the mark.')
  // A body that did not arrive as JSON could come from any page, with no preflight to stop it.
  const crossSite = await post({ note: 'from another page' }, 'text/plain')
  expect(crossSite.status).toBe(400)
  expect((await marks.list()).marks).toEqual([])
  const added = systemMarksSchema.parse(await (await post({ note: 'closed Docker' })).json())
  expect(added.marks.map((mark) => mark.note)).toEqual(['closed Docker'])
  const removed = await app.request(`/marks/${added.marks[0]!.id}`, { method: 'DELETE' })
  expect(systemMarksSchema.parse(await removed.json()).marks).toEqual([])
})

test.each([
  ['system_overview', { effect: 'read' }],
  ['system_processes', { effect: 'read' }],
  ['system_mark', { effect: 'host' }],
])('%s has the permission class %o', (name, expected) => {
  const ctx = {
    dataDir: dataDir(),
    z,
    defineTool: (tool: unknown) => tool,
  } as unknown as MiniAppContext
  const tool = register(ctx).tools!.find((candidate) => candidate.name === name)!
  // The host gate's rule: the tool's own class, else its static flag read fail-closed.
  const actual = tool.classify
    ? tool.classify({})
    : { effect: tool.mutates === false ? 'read' : 'external' }
  expect(actual).toEqual(expected)
})

test('the agent tool acts on the same store the view reads', async () => {
  const dir = dataDir()
  const ctx = {
    dataDir: dir,
    z,
    defineTool: (tool: unknown) => tool,
  } as unknown as MiniAppContext
  const tool = register(ctx).tools?.find((candidate) => candidate.name === 'system_mark')
  expect(tool?.mutates).toBe(true)
  expect(tool?.executionMode).toBe('sequential')
  const result = await tool!.execute('call-1', { note: 'after the build' })
  expect(result.content).toContain('"after the build"')
  const view = await createTemplateRoutes({
    read,
    processes: {} as never,
    marks: createSystemMarks(dir, read),
  }).request('/marks')
  expect(systemMarksSchema.parse(await view.json()).marks.map((mark) => mark.note)).toEqual([
    'after the build',
  ])
})
