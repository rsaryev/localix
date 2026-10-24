import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ModPaneRef, ModsOverview } from '@/shared/api/modsApi'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

const pane = (id: string, title: string): ModPaneRef => ({
  instance: `${id}~1`,
  plugin: id,
  id,
  title,
  cwd: '/work/localix',
  closeOnEscape: false,
  focusRequest: 0,
})

const overview: ModsOverview = {
  mods: [
    {
      plugin: 'replay-theater',
      version: '0.1.0',
      events: ['tool.call', 'turn.complete', 'ui.render'],
      panes: 1,
      draws: true,
      status: 'running',
    },
    {
      plugin: 'broken-mod',
      events: [],
      panes: 0,
      draws: false,
      status: 'failed',
      problem: 'The hooks module does not export a register function',
    },
  ],
  panes: [pane('replay-theater', 'Replay Theater'), pane('blast-radius', 'Blast Radius')],
  failures: { 'broken-mod': 'The hooks module does not export a register function' },
}

async function mount(data: ModsOverview, selected: ModPaneRef | null) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ModsWorkspaceView } = await import('./ModsWorkspaceView')
  const calls: unknown[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <ModsWorkspaceView
        overview={data}
        selected={selected}
        onSelect={(chosen) => calls.push(['select', chosen.id])}
        onOpenSettings={(plugin) => calls.push(['settings', plugin])}
        onBrowsePlugins={() => calls.push(['browse'])}
        renderPane={(shown) => <p>drawing of {shown.id}</p>}
      />,
    ),
  )
  const done = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  return { act, host, calls, done }
}

test('with no mod installed, the view says what a mod is and leads to the plugins', async () => {
  const { act, host, calls, done } = await mount({ mods: [], panes: [], failures: {} }, null)
  expect(host.textContent).toContain('No mods yet')
  expect(host.textContent).toContain('Claude Code plugin')
  const browse = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Browse plugins',
  )!
  await act(async () => browse.click())
  expect(calls).toEqual([['browse']])
  await done()
})

test('panes list with their mod and project; the chosen one is drawn and marked', async () => {
  const { act, host, calls, done } = await mount(overview, overview.panes[0]!)
  const rows = [...host.querySelectorAll('[data-slot="workbench-list-row"]')]
  const replay = rows.find((row) => row.textContent?.includes('Replay Theater'))!
  expect(replay.getAttribute('data-active')).toBe('true')
  expect(replay.textContent).toContain('replay-theater · localix')
  expect(host.textContent).toContain('drawing of replay-theater')
  const blast = rows.find((row) => row.textContent?.includes('Blast Radius'))!
  await act(async () => blast.querySelector('button')!.click())
  expect(calls).toEqual([['select', 'blast-radius']])
  await done()
})

test('each mod row says what it hooks, and a failed one says why, with its settings a click away', async () => {
  const { act, host, calls, done } = await mount(overview, null)
  const rows = [...host.querySelectorAll('[data-slot="workbench-list-row"]')]
  const replay = rows.find((row) => row.textContent?.includes('replay-theater 0.1.0'))!
  expect(replay.textContent).toContain('3 events · 1 pane · draws')
  const broken = rows.find((row) => row.textContent?.includes('broken-mod'))!
  expect(broken.textContent).toContain('does not export a register function')
  await act(async () =>
    broken.querySelector<HTMLButtonElement>('button[aria-label="broken-mod settings"]')!.click(),
  )
  expect(calls).toEqual([['settings', 'broken-mod']])
  expect(host.textContent).toContain('No pane open')
  await done()
})
