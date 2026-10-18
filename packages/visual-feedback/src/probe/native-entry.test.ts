import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

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
  for (let attempt = 0; attempt < 20; attempt += 1) {
    outcome = bridge!.take('snapshot-1')
    if (outcome) break
    await new Promise((resolve) => setTimeout(resolve, 10))
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
