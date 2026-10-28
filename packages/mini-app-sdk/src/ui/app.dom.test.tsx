import { afterAll, beforeAll, expect, test } from 'bun:test'
import { useEffect } from 'react'
import { z } from 'zod'
import { registerDom } from '@localixai/kit/testing/dom'
import { useAgentContext, useCollection, type CollectionView } from './app'
import type { PublishedMessageContext } from './message-bindings'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from './runtime'
import { bindMiniAppUiTransport } from './transport'
import { WorkItemSessionProvider } from './work-item-session'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const meal = z.object({ id: z.string(), title: z.string(), kcal: z.number() })
type Meal = z.infer<typeof meal>

/** A backend that keeps a list and answers every change with the new list, as a collection does. */
function fakeCollectionBackend() {
  let items: Meal[] = [{ id: 'm1', title: 'Oatmeal', kcal: 320 }]
  const requests: { method: string; path: string; body?: unknown }[] = []
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      requests.push({ method, path, ...(body ? { body } : {}) })
      const id = path.split('?')[0]!.split('/')[4]
      if (method === 'POST') items = [...items, { id: `m${items.length + 1}`, ...body }]
      if (method === 'PATCH') items = items.map((it) => (it.id === id ? { ...it, ...body } : it))
      if (method === 'DELETE') items = items.filter((it) => it.id !== id)
      return Response.json({ items })
    },
  })
  return { requests, unbind }
}

async function mount(render: () => React.ReactNode, sessionId: string | null = null) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const unbindRuntime = bindMiniAppUiRuntime({
    sessions: { list: () => [], subscribe: () => () => {} },
  } as unknown as MiniAppUiRuntime)
  const root = createRoot(document.createElement('div'))
  await act(async () =>
    root.render(
      <WorkItemSessionProvider sessionId={sessionId}>{render()}</WorkItemSessionProvider>,
    ),
  )
  return {
    act,
    unmount: async () => {
      await act(async () => root.unmount())
      unbindRuntime()
    },
  }
}

test('a screen reads its collection, and adds, changes and removes items through it', async () => {
  const backend = fakeCollectionBackend()
  let meals!: CollectionView<Meal, Omit<Meal, 'id'>>
  function Screen() {
    const view = useCollection({ app: 'meals', name: 'meals', item: meal })
    useEffect(() => {
      meals = view
    })
    return null
  }
  const screen = await mount(() => <Screen />)
  try {
    expect(meals.items).toEqual([{ id: 'm1', title: 'Oatmeal', kcal: 320 }])

    await screen.act(async () => void (await meals.add({ title: 'Apple', kcal: 95 })))
    expect(meals.items.map((it) => it.title)).toEqual(['Oatmeal', 'Apple'])
    await screen.act(async () => void (await meals.update('m2', { kcal: 80 })))
    expect(meals.items[1]).toEqual({ id: 'm2', title: 'Apple', kcal: 80 })
    await screen.act(async () => void (await meals.remove('m1')))
    expect(meals.items.map((it) => it.id)).toEqual(['m2'])

    expect(backend.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /rpc/meals/meals',
      'POST /rpc/meals/meals',
      'PATCH /rpc/meals/meals/m2',
      'DELETE /rpc/meals/meals/m1',
    ])
  } finally {
    await screen.unmount()
    backend.unbind()
  }
})

test("a chat's collection is read and changed for the chat the screen belongs to", async () => {
  const backend = fakeCollectionBackend()
  let meals!: CollectionView<Meal, Omit<Meal, 'id'>>
  function Screen() {
    const view = useCollection({ app: 'meals', name: 'meals', item: meal, scope: 'chat' })
    useEffect(() => {
      meals = view
    })
    return null
  }
  const screen = await mount(() => <Screen />, 'chat 1')
  try {
    await screen.act(async () => void (await meals.add({ title: 'Apple', kcal: 95 })))

    expect(backend.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'GET /rpc/meals/meals?sessionId=chat%201',
      'POST /rpc/meals/meals?sessionId=chat%201',
    ])
  } finally {
    await screen.unmount()
    backend.unbind()
  }
})

test('the agent is given what the screen shows while it is open, and nothing once it is not', async () => {
  const published: (PublishedMessageContext | null)[] = []
  const publish = (context: PublishedMessageContext | null) => published.push(context)
  function Screen({ active, total }: { active: boolean; total: number }) {
    useAgentContext(publish, active, { label: 'Meals today', content: `Total: ${total} kcal` })
    return null
  }
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Screen active total={320} />))
    await act(async () => root.render(<Screen active total={415} />))
    await act(async () => root.render(<Screen active={false} total={415} />))

    const contents = published.map((context) =>
      context ? context.bindings[0]?.target.attributes?.content : null,
    )
    expect(contents.filter((content) => content !== null)).toEqual([
      'Total: 320 kcal',
      'Total: 415 kcal',
    ])
    expect(published.at(-1)).toBeNull()
  } finally {
    await act(async () => root.unmount())
  }
})
