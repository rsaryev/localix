import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ModAction, ModBandDrawing, ModElement } from '@/shared/api/modsApi'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
// `modsApi` is one object for the whole run: a spy left on it is read by the next file.
afterAll(async () => {
  mock.restore()
  await teardown()
})

/** A made-up mod's band: a label and one suggestion. */
const suggestion = (label: string): ModElement[] => [
  {
    type: 'Box',
    props: {},
    children: [
      { type: 'Text', props: { dimColor: true }, children: ['next:'] },
      { type: 'Button', props: { key: 'run', label, hotkey: '1' }, children: [] },
    ],
  },
]

/**
 * The band above a conversation's prompt box, with the server answering `drawing` for it. Each
 * test names its own conversation, so SWR's tab-wide cache never serves another test's band.
 */
async function mountBand(opts: {
  sessionId: string | null
  focused?: boolean
  drawing: () => ModBandDrawing
}) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { modsApi } = await import('@/shared/api/modsApi')
  const reads: Array<{ sessionId: string; columns: number; rows: number }> = []
  const actions: Array<{ sessionId: string; action: ModAction; page?: number }> = []
  spyOn(modsApi, 'band').mockImplementation(async (sessionId, columns, rows) => {
    reads.push({ sessionId, columns, rows })
    return opts.drawing()
  })
  spyOn(modsApi, 'bandAct').mockImplementation(async (sessionId, action, page) => {
    actions.push({ sessionId, action, ...(page ? { page } : {}) })
  })
  const { ModsAbovePrompt } = await import('./ModsAbovePrompt')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  /** Let the band's read answer: event-loop turns (the poke is delivered on one), no waiting. */
  const turns = async (count = 10) => {
    for (let turn = 0; turn < count; turn++)
      await React.act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  }
  await React.act(async () =>
    root.render(
      <ModsAbovePrompt sessionId={opts.sessionId} context={{ isFocused: opts.focused ?? true }} />,
    ),
  )
  await turns()
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
      candidate.textContent?.includes(label),
    )
  const done = async () => {
    await React.act(async () => root.unmount())
    host.remove()
  }
  return { React, host, reads, actions, button, turns, done }
}

describe('the mods’ band above the prompt box', () => {
  test('draws the band a mod answers for this conversation, at the room above the box', async () => {
    const band = await mountBand({
      sessionId: 's-draw',
      drawing: () => ({ sessionId: 's-draw', tree: suggestion('Run the tests') }),
    })
    expect(band.host.textContent).toContain('next:')
    expect(band.host.textContent).toContain('Run the tests')
    expect(band.reads).toEqual([{ sessionId: 's-draw', columns: 100, rows: 12 }])
    await band.done()
  })

  test('a press on the band’s Button goes to that conversation’s mods', async () => {
    const band = await mountBand({
      sessionId: 's-press',
      drawing: () => ({ sessionId: 's-press', tree: suggestion('Commit') }),
    })
    await band.React.act(async () => band.button('Commit')!.click())
    expect(band.actions).toEqual([
      { sessionId: 's-press', action: { kind: 'press', element: 'run' } },
    ])
    await band.done()
  })

  test('the band’s pages: a press on the second page names it', async () => {
    const band = await mountBand({
      sessionId: 's-pages',
      drawing: () => ({
        sessionId: 's-pages',
        tree: suggestion('Replay'),
        pages: [
          { mods: ['replay'], tree: suggestion('Replay') },
          { mods: ['weather'], tree: suggestion('Cloudy') },
        ],
        working: false,
      }),
    })
    const next = band.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Next mod band page"]',
    )!
    await band.React.act(async () => next.click())
    await band.React.act(async () => band.button('Cloudy')!.click())
    expect(band.actions).toEqual([
      { sessionId: 's-pages', action: { kind: 'press', element: 'run' }, page: 1 },
    ])
    await band.done()
  })

  test('the mods poke draws it again', async () => {
    let label = 'Commit'
    const band = await mountBand({
      sessionId: 's-poke',
      drawing: () => ({ sessionId: 's-poke', tree: suggestion(label) }),
    })
    expect(band.host.textContent).toContain('Commit')
    label = 'Open a PR'
    const { resourceSync } = await import('@/shared/api/resourceSync')
    await band.React.act(async () => resourceSync.invalidate(['mods']))
    await band.turns()
    expect(band.host.textContent).toContain('Open a PR')
    expect(band.host.textContent).not.toContain('Commit')
    await band.done()
  })

  test('nothing is drawn while no mod draws, for a composer out of focus, or with no conversation', async () => {
    const empty = await mountBand({
      sessionId: 's-empty',
      drawing: () => ({ sessionId: 's-empty', tree: null }),
    })
    expect(empty.host.textContent).toBe('')
    expect(empty.host.querySelector('button')).toBeNull()
    await empty.done()

    for (const opts of [
      { sessionId: 's-blurred', focused: false },
      { sessionId: null, focused: true },
    ]) {
      const band = await mountBand({
        ...opts,
        drawing: () => ({ sessionId: 'x', tree: suggestion('Commit') }),
      })
      expect(band.reads).toEqual([])
      expect(band.host.textContent).toBe('')
      await band.done()
    }
  })
})
