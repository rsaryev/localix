import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ModAction, ModBandPage, ModElement } from '@/shared/api/modsApi'

let teardown: () => Promise<void>
beforeAll(async () => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const { useChordStore } = await import('@localixai/kit/keybindings')
  const { resolveBindings } = await import('@/shared/lib/keybindings')
  useChordStore.getState().setResolved(resolveBindings(undefined))
})
afterAll(async () => {
  const { setModBandRotation } = await import('@/shared/lib/modBandRotationPref')
  setModBandRotation(true)
  await teardown()
})

/** A made-up mod's line, with a Button on `1`. */
const line = (words: string, key: string): ModElement[] => [
  {
    type: 'Box',
    props: {},
    children: [
      { type: 'Text', props: {}, children: [words] },
      { type: 'Button', props: { key, label: 'Go', hotkey: '1' }, children: [] },
    ],
  },
]
const REPLAY: ModBandPage = { mods: ['replay'], tree: line('▶ Replay: 1 edit', 'replay-go') }
const WEATHER: ModBandPage = { mods: ['weather', 'steps'], tree: line('☁ Cloudy', 'weather-go') }

/** A clock the test turns: each wait the band asks for is held until `fire`. */
function manualSchedule() {
  const waits = new Set<{ run: () => void; ms: number }>()
  return {
    schedule: (run: () => void, ms: number) => {
      const wait = { run, ms }
      waits.add(wait)
      return () => void waits.delete(wait)
    },
    pending: () => waits.size,
    fire: () => {
      for (const wait of Array.from(waits)) {
        waits.delete(wait)
        wait.run()
      }
    },
  }
}

let chats = 0

async function mount(pages: ModBandPage[], opts: { sessionId?: string; working?: boolean } = {}) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ModBand } = await import('./ModBand')
  const sessionId = opts.sessionId ?? `pages-${(chats += 1)}`
  const clock = manualSchedule()
  const actions: Array<{ action: ModAction; page: number }> = []
  const shell = document.createElement('div')
  shell.setAttribute('data-agent-link-drop-target', '')
  const slot = document.createElement('div')
  const field = document.createElement('textarea')
  shell.append(slot, field)
  document.body.append(shell)
  const root = createRoot(slot)
  const draw = (next: ModBandPage[], working = opts.working ?? false) =>
    act(async () =>
      root.render(
        <ModBand
          sessionId={sessionId}
          pages={next}
          working={working}
          act={(action, page) => actions.push({ action, page })}
          afterPause={(run) => (run(), () => {})}
          schedule={clock.schedule}
        />,
      ),
    )
  await draw(pages)
  const pager = () => slot.querySelector<HTMLElement>('[role="group"][aria-label^="Mod band page"]')
  const click = (label: string) =>
    act(async () => slot.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click())
  const key = (init: KeyboardEventInit) =>
    act(async () => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
      )
    })
  const type = (value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        field,
        value,
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const done = async () => {
    await act(async () => root.unmount())
    shell.remove()
  }
  return { act, slot, field, actions, clock, draw, pager, click, key, type, done, sessionId }
}

describe('the band’s pages', () => {
  test('one page has no pager', async () => {
    const band = await mount([REPLAY])
    expect(band.pager()).toBeNull()
    expect(band.clock.pending()).toBe(0)
    await band.done()
  })

  test('two pages: a pager names the page, ‹ › turn it, and a press reaches its page', async () => {
    const band = await mount([REPLAY, WEATHER])
    expect(band.pager()!.getAttribute('aria-label')).toBe('Mod band page 1 of 2')
    expect(band.slot.textContent).toContain('▶ Replay: 1 edit')
    expect(band.slot.textContent).not.toContain('Cloudy')
    await band.click('Next mod band page')
    expect(band.pager()!.getAttribute('aria-label')).toBe('Mod band page 2 of 2')
    expect(band.slot.textContent).toContain('☁ Cloudy')
    await band.act(async () =>
      [...band.slot.querySelectorAll('button')]
        .find((b) => b.textContent?.startsWith('Go'))!
        .click(),
    )
    expect(band.actions).toEqual([{ action: { kind: 'press', element: 'weather-go' }, page: 1 }])
    await band.click('Previous mod band page')
    expect(band.pager()!.getAttribute('aria-label')).toBe('Mod band page 1 of 2')
    await band.done()
  })

  test('⌥] and ⌥[ in the composer turn the pages; only the page showing answers its digit', async () => {
    const band = await mount([REPLAY, WEATHER])
    await band.key({ key: ']', code: 'BracketRight', altKey: true })
    expect(band.pager()!.getAttribute('aria-label')).toBe('Mod band page 2 of 2')
    await band.type('1')
    expect(band.actions).toEqual([{ action: { kind: 'press', element: 'weather-go' }, page: 1 }])
    await band.key({ key: '[', code: 'BracketLeft', altKey: true })
    expect(band.pager()!.getAttribute('aria-label')).toBe('Mod band page 1 of 2')
    await band.done()
  })

  test('the band turns its page after a while, while nothing holds it', async () => {
    const band = await mount([REPLAY, WEATHER])
    expect(band.clock.pending()).toBe(1)
    await band.act(async () => band.clock.fire())
    expect(band.pager()!.getAttribute('aria-label')).toBe('Mod band page 2 of 2')
    // And on round to the first, a wait at a time.
    expect(band.clock.pending()).toBe(1)
    await band.act(async () => band.clock.fire())
    expect(band.pager()!.getAttribute('aria-label')).toBe('Mod band page 1 of 2')
    await band.done()
  })

  test('hover, focus in the band, a draft in the box and a running turn each hold the page', async () => {
    const band = await mount([REPLAY, WEATHER])
    const strip = band.slot.firstElementChild as HTMLElement
    await band.act(async () => {
      strip.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })
    expect(band.clock.pending()).toBe(0)
    await band.act(async () => {
      strip.dispatchEvent(
        new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
      )
    })
    expect(band.clock.pending()).toBe(1)

    const region = band.slot.querySelector<HTMLElement>('[role="region"]')!
    await band.act(async () => region.focus())
    expect(band.clock.pending()).toBe(0)
    await band.act(async () => region.blur())
    expect(band.clock.pending()).toBe(1)

    await band.type('fix the')
    expect(band.clock.pending()).toBe(0)
    await band.type('')
    expect(band.clock.pending()).toBe(1)

    await band.draw([REPLAY, WEATHER], true)
    expect(band.clock.pending()).toBe(0)
    await band.done()
  })

  test('no turning with reduced motion, or with the setting off', async () => {
    const { setModBandRotation } = await import('@/shared/lib/modBandRotationPref')
    setModBandRotation(false)
    const off = await mount([REPLAY, WEATHER])
    expect(off.clock.pending()).toBe(0)
    await off.done()
    setModBandRotation(true)

    const before = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    try {
      const reduced = await mount([REPLAY, WEATHER])
      expect(reduced.clock.pending()).toBe(0)
      await reduced.done()
    } finally {
      window.matchMedia = before
    }
  })

  test('a page the person picks stays for the chat until it is gone', async () => {
    const band = await mount([REPLAY, WEATHER])
    await band.click('Next mod band page')
    // Picked: the band no longer turns, and a redraw keeps the page.
    expect(band.clock.pending()).toBe(0)
    await band.done()
    const again = await mount([REPLAY, WEATHER], { sessionId: band.sessionId })
    expect(again.pager()!.getAttribute('aria-label')).toBe('Mod band page 2 of 2')
    // The picked page is gone: the band shows the first and may turn again once there are more.
    await again.draw([REPLAY])
    expect(again.slot.textContent).toContain('Replay')
    await again.draw([REPLAY, WEATHER])
    expect(again.pager()!.getAttribute('aria-label')).toBe('Mod band page 1 of 2')
    expect(again.clock.pending()).toBe(1)
    await again.done()
  })

  test('collapsed, the band sums up every page; a page’s part opens the band on it', async () => {
    const band = await mount([REPLAY, WEATHER])
    await band.click('Collapse the band')
    const summary = band.slot.querySelector('[role="group"][aria-label="Mods band, collapsed"]')!
    const parts = [...summary.querySelectorAll('button')].map((part) => part.textContent)
    expect(parts).toEqual(['▶ Replay: 1 edit Go', '☁ Cloudy Go'])
    await band.act(async () => summary.querySelectorAll('button')[1]!.click())
    expect(band.pager()!.getAttribute('aria-label')).toBe('Mod band page 2 of 2')
    await band.done()
  })
})
