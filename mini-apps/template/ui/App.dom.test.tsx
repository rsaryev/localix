import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { PublishedMessageContext } from '@localixai/mini-app-sdk/ui'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { registerDom } from '@localixai/kit/testing'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'
import type { Entry } from '../shared/model'

let teardown: () => Promise<void>
let unbindDoubles: () => void
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  teardown = registerDom()
  unbindDoubles = bindMiniAppUiTestDoubles()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  unbindDoubles()
  await teardown()
  if (priorActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment
})

/** The app's routes as the backend answers them: settings, and a list every change answers with. */
function backend(initial: Entry[]) {
  let entries = initial
  const sent: unknown[] = []
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path, init) => {
      if (path.endsWith('/settings')) return Response.json({ dailyGoal: 2000, unit: 'kcal' })
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        sent.push(body)
        entries = [
          ...entries,
          { id: 'new', category: 'General', note: '', at: new Date().toISOString(), ...body },
        ]
      }
      return Response.json({ items: entries })
    },
  })
  return { sent, unbind }
}

async function render(entries: Entry[]) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { App } = await import('./App')
  const server = backend(entries)
  const contexts: (PublishedMessageContext | null)[] = []
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(<App active publishMessageContext={(context) => contexts.push(context)} />),
  )
  return {
    act,
    container,
    server,
    contexts,
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
      server.unbind()
    },
  }
}

const today = (hour: number) => {
  const at = new Date()
  at.setHours(hour, 0, 0, 0)
  return at.toISOString()
}

test("shows today's total against the goal and tells the agent the same numbers", async () => {
  const screen = await render([
    { id: 'a', title: 'Oatmeal', amount: 320, category: 'Breakfast', note: '', at: today(0) },
    { id: 'b', title: 'Soup', amount: 480, category: 'Lunch', note: '', at: today(0) },
  ])
  try {
    const text = screen.container.textContent ?? ''
    expect(text).toContain('800')
    expect(text).toContain('of 2000 kcal')
    expect(text).toContain('1200 kcal left')
    expect(text).toContain('Oatmeal')
    expect(text).toContain('Lunch')
    const published = screen.contexts.findLast((context) => context !== null)
    expect(published?.bindings[0]?.target.attributes?.content).toContain(
      'Today: 800 of 2000 kcal (40%), 1200 kcal left.',
    )
  } finally {
    await screen.unmount()
  }
})

test('with nothing logged, says how to log from the chat', async () => {
  const screen = await render([])
  try {
    expect(screen.container.textContent).toContain('Nothing logged today')
    expect(screen.container.textContent).toContain('in the chat')
  } finally {
    await screen.unmount()
  }
})

test('logs an entry from the quick form and shows it at once', async () => {
  const screen = await render([])
  try {
    const title = screen.container.querySelector<HTMLInputElement>('input[aria-label="What"]')!
    const amount = screen.container.querySelector<HTMLInputElement>('input[aria-label="Amount"]')!
    const setValue = (input: HTMLInputElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await screen.act(async () => {
      setValue(title, 'Apple')
      setValue(amount, '95')
    })
    await screen.act(async () => {
      screen.container.querySelector('form')!.requestSubmit()
    })

    expect(screen.server.sent).toEqual([{ title: 'Apple', amount: 95 }])
    expect(screen.container.textContent).toContain('Apple')
    expect(title.value).toBe('')
  } finally {
    await screen.unmount()
  }
})
