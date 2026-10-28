import { expect, test } from 'bun:test'
import { z } from 'zod'
import { createMiniApp } from './app'
import { defineCollection } from './collection'
import type { MiniAppContext } from './context'
import { callTool, fakeSemantic, requestRoute, testMiniAppContext } from './testing'

const notes = defineCollection({
  name: 'notes',
  item: z.object({ id: z.string(), text: z.string() }),
  input: z.object({ text: z.string() }),
  create: (input, { id }) => ({ id, ...input }),
})

function register(ctx: MiniAppContext) {
  const app = createMiniApp(ctx)
  const collection = app.collection(notes)
  return app.registration({
    tools: [
      ctx.defineTool({
        name: 'note',
        label: 'Note',
        activeVerb: 'Saving a note',
        description: 'Save a note.',
        inputSchema: ctx.z.object({ text: ctx.z.string() }),
        mutates: true,
        classify: () => ({ effect: 'host' }),
        async execute(_id, input: { text: string }, _signal, _update, context) {
          await collection.add(input)
          return { content: `Saved in ${context?.session?.id ?? 'no chat'}.` }
        },
      }),
    ],
  })
}

test('a mini app is tested through what the agent calls and what the screen requests', async () => {
  await using ctx = await testMiniAppContext({ name: 'jot' })
  const registration = register(ctx)

  const result = await callTool(registration, 'note', { text: 'Buy milk' })
  expect(result).toEqual({ text: 'Saved in test-chat.', isError: false })

  const listed = await requestRoute(registration, 'GET', '/notes')
  expect(listed.status).toBe(200)
  expect(listed.json).toEqual({ items: [expect.objectContaining({ text: 'Buy milk' })] })
  const refused = await requestRoute(registration, 'POST', '/notes', { text: 3 })
  expect(refused.status).toBe(400)
})

test('names the tool that does not exist instead of failing on undefined', async () => {
  await using ctx = await testMiniAppContext({ name: 'jot' })

  await expect(callTool(register(ctx), 'missing', {})).rejects.toThrow(
    'No tool "missing": the tools are note.',
  )
})

test('a fake semantic index finds items by their words once the model is ready', async () => {
  const semantic = fakeSemantic()
  await using ctx = await testMiniAppContext({ name: 'notes', host: { semantic } })
  const collection = createMiniApp(ctx).collection(
    defineCollection({ ...notes, search: (note) => note.text }),
  )
  const soup = await collection.add({ text: 'Tomato soup recipe' })
  await collection.add({ text: 'Toast' })

  expect(await collection.search('soup')).toEqual([])
  semantic.ready = true
  expect(await collection.search('tomato SOUP')).toEqual([soup])
})
