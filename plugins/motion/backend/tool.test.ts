import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import type { PluginContext } from '@localixai/plugin-sdk/backend'
import { register, createRoutes } from './index'
import { toolInputSchema } from './tool'
import { layerSchema } from '../shared/schema'
import { createTemplateDocument } from '../shared/templates'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
test('agent guide and custom authoring share canonical state with the workbench and reject stale edits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'localix-motion-tool-'))
  dirs.push(dir)
  const ctx = {
    dataDir: dir,
    userId: 'owner',
    cwd: dir,
    z,
    defineTool: (tool: unknown) => tool,
  } as unknown as PluginContext
  const tool = register(ctx).tools!.find((tool) => tool.name === 'motion_studio')!
  expect(tool.classify?.({ action: 'guide' })).toEqual({ effect: 'read' })
  expect(tool.classify?.({ action: 'create' })).toEqual({ effect: 'files' })
  expect(tool.permissionPaths?.({ action: 'create' })).toEqual([])
  expect(tool.permissionPaths?.({ action: 'create', template: 'blank', title: 'Film' })).toEqual([
    join(dir, '.localix/motion'),
  ])
  const guide = JSON.parse((await tool.execute('guide', { action: 'guide' })).content)
  expect(Object.keys(guide.templates)).toHaveLength(12)
  expect(guide.templates.blackout.category).toBe('Typography')
  expect(guide.templates.relay.category).toBe('Product')
  expect(guide.templates.nightfall.category).toBe('Brand')
  expect(guide.primitives.layouts).toEqual(expect.arrayContaining(['hook', 'focus', 'wordmark']))
  expect(guide.schema.properties.scenes).toBeDefined()
  const document = createTemplateDocument('kinetic', 'Authored film')
  document.scenes[0]!.layers = [
    layerSchema.parse({
      id: crypto.randomUUID(),
      kind: 'circle',
      color: 'accent',
      keyframes: [
        { time: 0, x: 0.1, y: 0.8, scale: 0, opacity: 0 },
        { time: 0.8, x: 0.9, y: 0.2 },
      ],
    }),
  ]
  const created = JSON.parse(
    (
      await tool.execute(
        'create',
        toolInputSchema.parse({
          action: 'create',
          template: 'kinetic',
          title: document.title,
          document,
        }),
      )
    ).content,
  )
  expect(created.uri).toContain(created.id)
  expect(created.revision).toBe(1)
  const response = await createRoutes().request(
    '/library',
    {},
    { userId: 'owner', cwd: dir, sessionId: 'live' },
  )
  const state = await response.json()
  expect(state.projects[0].document).toEqual(document)
  await tool.execute('update', {
    action: 'update',
    id: created.id,
    revision: 1,
    document: { ...document, title: 'Saved user edit' },
  })
  const stale = await tool.execute('update', {
    action: 'update',
    id: created.id,
    revision: 1,
    document,
  })
  expect(stale.isError).toBe(true)
  expect(stale.content).toContain('conflict')
  const current = JSON.parse((await tool.execute('get', { action: 'get', id: created.id })).content)
  expect(current.document.title).toBe('Saved user edit')
  expect(current.revision).toBe(2)
  const duplicate = JSON.parse(
    (await tool.execute('duplicate', { action: 'duplicate', id: created.id, title: 'Variant' }))
      .content,
  )
  expect(duplicate.id).not.toBe(created.id)
  expect(duplicate.document.scenes[0].layers).toEqual(document.scenes[0]!.layers)
})
