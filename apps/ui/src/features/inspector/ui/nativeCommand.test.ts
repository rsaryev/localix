import { expect, test } from 'bun:test'
import { navigatedAfter, navigatedResult, runInPage } from './nativeCommand'

/** A fake shell whose page answers `take` and the bridge check from scripted states. */
function shell(page: {
  takes: unknown[]
  bridge?: boolean[]
  loading?: boolean[]
  leaving?: boolean[]
}) {
  const calls: string[] = []
  const invoke = async (command: string, args?: Record<string, unknown>) => {
    calls.push(command)
    if (command === 'browser_navigation_state') return { loading: page.loading?.shift() ?? false }
    if (command !== 'browser_eval') return undefined
    const script = String(args?.script)
    if (script.includes('take(')) return JSON.stringify(page.takes.shift() ?? null)
    return JSON.stringify({
      bridge: page.bridge?.shift() ?? true,
      leaving: page.leaving?.shift() ?? false,
    })
  }
  return { invoke, calls }
}

test('a command whose document was replaced before it answered reads as replaced', async () => {
  const page = shell({ takes: [null, '__localixReplaced'] })
  expect(await runInPage(page.invoke, 'tab-1234', 'cmd', { action: 'click' })).toBe('replaced')
})

test('a command answered by its page returns that answer', async () => {
  const page = shell({ takes: [{ ok: true, result: { action: 'click', note: 'clicked' } }] })
  expect(await runInPage(page.invoke, 'tab-1234', 'cmd', { action: 'click' })).toEqual({
    ok: true,
    result: { action: 'click', note: 'clicked' },
  })
})

test('an action that started a load is followed until the next document replaces the page', async () => {
  const page = shell({ takes: [], loading: [true, true], bridge: [true, false] })
  expect(await navigatedAfter(page.invoke, 'tab-1234', 'click')).toBe(true)
})

test('a navigation the page started is followed although the shell does not report it', async () => {
  const page = shell({ takes: [], loading: [false, false], bridge: [true, false], leaving: [true] })
  expect(await navigatedAfter(page.invoke, 'tab-1234', 'click')).toBe(true)
})

test('an action on a page that is not loading, or a read, did not navigate', async () => {
  const idle = shell({ takes: [], loading: [false], bridge: [true] })
  expect(await navigatedAfter(idle.invoke, 'tab-1234', 'click')).toBe(false)
  const read = shell({ takes: [] })
  expect(await navigatedAfter(read.invoke, 'tab-1234', 'snapshot')).toBe(false)
  expect(read.calls).toEqual([])
})

test('a navigated result names the new address and carries its page instead of a diff', () => {
  const result = navigatedResult(
    'click',
    { action: 'click', note: 'clicked link "Next"', diff: '+ old' },
    { action: 'snapshot', snapshot: { url: 'https://example.com/2', tree: '...' } },
  )
  expect(result).toMatchObject({
    action: 'click',
    diff: undefined,
    snapshot: { url: 'https://example.com/2' },
  })
  expect(result.note).toStartWith(
    'clicked link "Next" — the page navigated to https://example.com/2',
  )
})
