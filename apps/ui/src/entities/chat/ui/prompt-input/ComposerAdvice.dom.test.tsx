import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { makeListing } from '@localixai/store/testing'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(() => window.localStorage.clear())

const docker = makeListing({ id: 'docker', kind: 'plugin', displayName: 'Docker tools' })

describe('advice above the composer', () => {
  test('one piece at a time: a tip waits while a recommendation is shown', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { RecommendationsRow } = await import('./RecommendationsRow')
    const { StatusTipStrip } = await import('./StatusTipStrip')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await React.act(async () =>
      root.render(
        <>
          <RecommendationsRow
            answer={{ listings: [docker], matched: 1, reasons: {} }}
            onSee={() => {}}
          />
          <StatusTipStrip tip={{ id: 't1', text: 'Press Esc to interrupt' }} />
        </>,
      ),
    )
    try {
      expect(host.textContent).toContain('Docker tools')
      expect(host.textContent).not.toContain('Press Esc to interrupt')

      const hide = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Hide until there are new recommendations"]',
      )!
      await React.act(async () => hide.click())

      expect(host.textContent).not.toContain('Docker tools')
      expect(host.textContent).toContain('Press Esc to interrupt')
    } finally {
      await React.act(async () => root.unmount())
      host.remove()
    }
  })
})
