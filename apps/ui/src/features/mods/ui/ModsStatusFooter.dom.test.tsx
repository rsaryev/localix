import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ModSessionView } from '@/shared/api/modsApi'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
// `modsApi` and `composerBus` are shared by the whole run: a spy left on them is read by the next file.
afterAll(async () => {
  mock.restore()
  await teardown()
})

const ESC = '\u001b'

/**
 * The status rows under a conversation's message box, with the server answering `view` for it.
 * Each test names its own conversation, so SWR's tab-wide cache never serves another test's.
 */
async function mountFooter(opts: {
  sessionId: string
  view: Partial<ModSessionView>
  hasInteraction?: boolean
}) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { modsApi } = await import('@/shared/api/modsApi')
  const { composerBus } = await import('@/shared/lib/composerBus')
  const inserts: Array<{ text?: string }> = []
  const taken: unknown[] = []
  spyOn(composerBus, 'insert').mockImplementation((request) => void inserts.push(request))
  spyOn(modsApi, 'session').mockImplementation(async () => ({
    fills: [],
    suggestion: null,
    statuses: {},
    ...opts.view,
  }))
  spyOn(modsApi, 'taken').mockImplementation(async (_id, body) => void taken.push(body))
  const { ModsStatusFooter } = await import('./ModsStatusFooter')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () =>
    root.render(
      <ModsStatusFooter
        sessionId={opts.sessionId}
        context={{ hasInteraction: opts.hasInteraction ?? false }}
      />,
    ),
  )
  for (let turn = 0; turn < 10; turn++)
    await React.act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const rows = () => [...host.querySelectorAll('[data-status-source]')] as HTMLElement[]
  return {
    host,
    rows,
    inserts,
    taken,
    done: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('the status area under the message box', () => {
  test('the command first, then each mod, every printed row its own row; no chip, no raw key', async () => {
    const footer = await mountFooter({
      sessionId: 's-rows',
      view: {
        statuses: {
          'git-mod': 'branch main',
          statusLine: '[Opus] project\n▓▓▓░░░ 30%',
        },
      },
    })
    expect(footer.rows().map((row) => [row.dataset.statusSource, row.textContent])).toEqual([
      ['statusLine', '[Opus] project'],
      ['statusLine', '▓▓▓░░░ 30%'],
      ['git-mod', 'branch main'],
    ])
    expect(footer.host.textContent).not.toContain('statusLine:')
    expect(footer.host.querySelector('svg')).toBeNull()
    // A status line redraws all the time: a labelled group, never a live region that would
    // read every redraw aloud.
    expect(footer.host.querySelector('[role="status"]')).toBeNull()
    expect(footer.host.querySelector('[role="group"][aria-label="Status"]')).not.toBeNull()
    await footer.done()
  })

  test('a long row is cut with an ellipsis and keeps its whole text as its title', async () => {
    const long = 'x'.repeat(400)
    const footer = await mountFooter({
      sessionId: 's-long',
      view: { statuses: { statusLine: long } },
    })
    const [row] = footer.rows()
    expect(row!.className).toContain('text-ellipsis')
    expect(row!.className).toContain('overflow-hidden')
    expect(row!.title).toBe(long)
    await footer.done()
  })

  test('colors are the app’s tokens, never the script’s raw hue', async () => {
    const footer = await mountFooter({
      sessionId: 's-color',
      view: {
        statuses: { statusLine: `${ESC}[31mred${ESC}[0m ${ESC}[38;2;255;0;0mexact${ESC}[0m plain` },
      },
    })
    const spans = [...footer.rows()[0]!.querySelectorAll('span')] as HTMLElement[]
    // The painted color is a mix of a status token; the tone it was read as is on the span.
    expect(spans.map((span) => span.dataset.tone)).toEqual([
      'danger',
      undefined,
      'danger',
      undefined,
    ])
    expect(footer.host.innerHTML).not.toMatch(/rgb\(255, 0, 0\)|#ff0000/i)
    await footer.done()
  })

  test('text that looks like markup stays text', async () => {
    const footer = await mountFooter({
      sessionId: 's-xss',
      view: { statuses: { statusLine: '<img src=x onerror=alert(1)> <b>bold</b>' } },
    })
    expect(footer.host.querySelector('img')).toBeNull()
    expect(footer.host.querySelector('b')).toBeNull()
    expect(footer.rows()[0]!.textContent).toBe('<img src=x onerror=alert(1)> <b>bold</b>')
    await footer.done()
  })

  test('an OSC 8 link is a link; an unsafe destination is plain text', async () => {
    const footer = await mountFooter({
      sessionId: 's-link',
      view: {
        statuses: {
          statusLine:
            `${ESC}]8;;https://example.com/repo${ESC}\\repo${ESC}]8;;${ESC}\\ ` +
            `${ESC}]8;;javascript:alert(1)${ESC}\\evil${ESC}]8;;${ESC}\\`,
        },
      },
    })
    const links = [...footer.host.querySelectorAll('a')] as HTMLAnchorElement[]
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['repo', 'https://example.com/repo'],
    ])
    expect(footer.rows()[0]!.textContent).toBe('repo evil')
    await footer.done()
  })

  test('nothing is drawn while no source has a line', async () => {
    const footer = await mountFooter({ sessionId: 's-none', view: {} })
    expect(footer.host.innerHTML).toBe('')
    await footer.done()
  })

  test('a question open hides the rows, yet a mod’s draft still reaches the box once', async () => {
    const footer = await mountFooter({
      sessionId: 's-ask',
      hasInteraction: true,
      view: {
        statuses: { statusLine: 'hidden while asking' },
        fills: [{ id: 'f1', text: 'run the tests', mode: 'replace' }],
      },
    })
    expect(footer.host.textContent).toBe('')
    expect(footer.inserts.map((insert) => insert.text)).toEqual(['run the tests'])
    expect(footer.taken).toEqual([{ fills: ['f1'] }])
    await footer.done()
  })
})
