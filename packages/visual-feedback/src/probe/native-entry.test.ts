import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// The bridge answers after the page's DOM has been quiet for ~100 ms (real time): poll for it.
const turns = () => new Promise((r) => setTimeout(r, 5))

beforeAll(() => GlobalRegistrator.register())
afterAll(async () => {
  delete window.__localixBrowser
  await GlobalRegistrator.unregister()
})

test('the native bridge installs once and returns an agent snapshot by command ID', async () => {
  document.body.innerHTML = '<button>New Game</button>'
  await import('./native-entry')
  const bridge = window.__localixBrowser
  expect(bridge).toBeDefined()
  bridge!.run('snapshot-1', { action: 'snapshot' })
  let outcome: unknown
  for (let attempt = 0; attempt < 200; attempt += 1) {
    outcome = bridge!.take('snapshot-1')
    if (outcome) break
    await turns()
  }
  expect(outcome).toMatchObject({ ok: true, result: { action: 'snapshot' } })
  expect(bridge!.take('snapshot-1')).toBeUndefined()
})

test('an unload that started reads as leaving, and fades when nothing replaces the page', async () => {
  await import('./native-entry')
  const bridge = window.__localixBrowser!
  expect(bridge.leaving()).toBe(false)
  const now = Date.now()
  const clock = spyOn(Date, 'now').mockReturnValue(now)
  try {
    window.dispatchEvent(new Event('beforeunload'))
    expect(bridge.leaving()).toBe(true)
    clock.mockReturnValue(now + 3000)
    expect(bridge.leaving()).toBe(false)
  } finally {
    clock.mockRestore()
  }
})

async function answer(
  id: string,
  command: Parameters<NonNullable<Window['__localixBrowser']>['run']>[1],
) {
  const bridge = window.__localixBrowser!
  bridge.run(id, command)
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const outcome = bridge.take(id) as { result?: Record<string, unknown> } | undefined
    if (outcome) return outcome
    await turns()
  }
  throw new Error('the bridge did not answer')
}

test('a confirm() the page opens during a click is cancelled and named in the reply', async () => {
  await import('./native-entry')
  document.body.innerHTML = '<button id="del">Delete</button>'
  let answered: boolean | undefined
  ;(document.querySelector('#del') as HTMLButtonElement).onclick = () => {
    answered = window.confirm('Delete everything?')
  }
  const snap = (await answer('s', { action: 'snapshot' })) as {
    result: { snapshot: { tree: string } }
  }
  const ref = /\[ref=(e\d+)\]/.exec(snap.result.snapshot.tree)![1]
  const reply = await answer('c', { action: 'click', ref })
  expect(answered).toBe(false)
  expect(reply.result?.recentErrors).toContain('[dialog] confirm("Delete everything?") cancelled')
})

test('a stylesheet that failed to load is listed in the next snapshot', async () => {
  await import('./native-entry')
  document.body.innerHTML = '<button>Go</button>'
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = 'assets/theme.css'
  document.head.appendChild(link)
  link.dispatchEvent(new Event('error'))
  const reply = (await answer('r', { action: 'snapshot' })) as {
    result: { snapshot: { failedResources?: string[] } }
  }
  expect(reply.result.snapshot.failedResources).toContain('stylesheet assets/theme.css')
})

test('a page that still shows a progress bar after the command is marked busy', async () => {
  await import('./native-entry')
  document.body.innerHTML = '<button>Go</button>'
  expect((await answer('b1', { action: 'snapshot' })).result?.busy).toBeUndefined()
  document.body.innerHTML = '<button>Go</button><div role="progressbar"></div>'
  document.querySelector('[role=progressbar]')!.getBoundingClientRect = () =>
    new DOMRect(10, 10, 100, 8)
  expect((await answer('b2', { action: 'snapshot' })).result?.busy).toBe(true)
})
