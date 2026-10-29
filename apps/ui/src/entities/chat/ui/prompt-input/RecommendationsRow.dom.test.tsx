import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { Listing } from '@localixai/store'
import { makeListing } from '@localixai/store/testing'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(() => window.localStorage.clear())

const docker = makeListing({ id: 'docker', kind: 'plugin', displayName: 'Docker tools' })
const k8s = makeListing({ id: 'k8s', kind: 'plugin', displayName: 'Kubernetes' })
const helm = makeListing({ id: 'helm', kind: 'plugin', displayName: 'Helm' })
const filler = makeListing({ id: 'filler', kind: 'plugin', displayName: 'Popular thing' })

async function mount(listings: Listing[], matched: number) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RecommendationsRow } = await import('./RecommendationsRow')
  const opened: string[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (next: Listing[], suited: number) =>
    React.act(async () =>
      root.render(
        <RecommendationsRow
          answer={{ listings: next, matched: suited }}
          onSee={() => opened.push('recommendations')}
        />,
      ),
    )
  await render(listings, matched)
  const button = (name: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
    )
  return {
    host,
    opened,
    render,
    click: (name: string) => React.act(async () => button(name)!.click()),
    unmount: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('the composer’s recommendations row', () => {
  test('says what suits the work and opens the recommendations in the Store', async () => {
    const view = await mount([docker, k8s, helm, filler], 3)
    try {
      expect(view.host.textContent).toContain('Recommended for you')
      expect(view.host.textContent).toContain('Docker tools, Kubernetes and 1 more')
      expect(view.host.textContent).not.toContain('Popular thing')
      await view.click('See')
      expect(view.opened).toEqual(['recommendations'])
      expect(view.host.textContent).not.toContain('Recommended for you')
    } finally {
      await view.unmount()
    }
  })

  test('one package suits the work; several suit it', async () => {
    const view = await mount([docker], 1)
    try {
      expect(view.host.textContent).toContain('Docker tools suits what you work on')
      await view.render([docker, k8s], 2)
      expect(view.host.textContent).toContain('Docker tools and Kubernetes suit what you work on')
    } finally {
      await view.unmount()
    }
  })

  test('packages that only fill the row are no news: nothing suited, nothing shown', async () => {
    const view = await mount([filler], 0)
    try {
      expect(view.host.textContent).toBe('')
    } finally {
      await view.unmount()
    }
  })

  test('hidden, it stays hidden until something new suits the work', async () => {
    const view = await mount([docker, filler], 1)
    try {
      await view.click('Hide until there are new recommendations')
      expect(view.host.textContent).toBe('')
      await view.render([docker, filler], 1)
      expect(view.host.textContent).toBe('')
      await view.render([k8s, docker, filler], 2)
      expect(view.host.textContent).toContain('Kubernetes')
    } finally {
      await view.unmount()
    }
  })
})
