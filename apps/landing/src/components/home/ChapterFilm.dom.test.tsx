import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
let observer: typeof IntersectionObserver | undefined
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // Without an observer the player counts as on screen, so the playing chapter gets its source.
  observer = globalThis.IntersectionObserver
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
})
afterAll(async () => {
  if (observer) globalThis.IntersectionObserver = observer
  await teardown()
})

const CHAPTERS = ['One', 'Two', 'Three', 'Four', 'Five'].map((label) => ({
  key: label.toLowerCase(),
  label,
  title: `${label} title.`,
  detail: `${label} detail.`,
  alt: label,
}))

async function mount(films?: typeof CHAPTERS) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ChapterFilm } = await import('./ChapterFilm')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<ChapterFilm films={films} />))
  return {
    act,
    video: () => host.querySelector('video')!,
    chapters: () => [...host.querySelectorAll<HTMLButtonElement>('.film-chapter')],
    current: () => host.querySelector('[aria-current="true"]')?.textContent,
    heading: () => host.querySelector('h2[data-current]')?.textContent,
    async close() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

test('the homepage shows the team film alone, looping, with no chapter row', async () => {
  const view = await mount()
  try {
    expect(view.video().getAttribute('src')).toBe('/films/team.mp4')
    expect(view.video().muted).toBe(true)
    expect(view.video().loop).toBe(true)
    expect(view.heading()).toContain('A team in one conversation.')
    expect(view.chapters()).toHaveLength(0)
  } finally {
    await view.close()
  }
})

test('several films run as chapters in order and wrap after the last', async () => {
  const view = await mount(CHAPTERS)
  try {
    expect(view.chapters().map((chapter) => chapter.textContent)).toEqual(
      CHAPTERS.map((film) => film.label),
    )
    expect(view.video().getAttribute('src')).toBe('/films/one.mp4')
    expect(view.video().loop).toBe(false)

    await view.act(async () => view.video().dispatchEvent(new Event('ended')))
    expect(view.video().getAttribute('src')).toBe('/films/two.mp4')
    expect(view.current()).toBe('Two')
    expect(view.heading()).toContain('Two title.')
    expect(document.querySelectorAll('h2:not([aria-hidden])')).toHaveLength(1)

    await view.act(async () => view.chapters().at(-1)!.click())
    expect(view.video().getAttribute('poster')).toBe('/films/five.jpg')
    await view.act(async () => view.video().dispatchEvent(new Event('ended')))
    expect(view.video().getAttribute('src')).toBe('/films/one.mp4')
  } finally {
    await view.close()
  }
})

test('past chapters read full and arrow keys move between chapters', async () => {
  const view = await mount(CHAPTERS)
  try {
    const four = view.chapters()[3]!
    await view.act(async () => four.click())
    const fills = [...document.querySelectorAll<HTMLElement>('.film-chapter-fill')]
    expect(fills.slice(0, 3).map((fill) => fill.style.transform)).toEqual(
      Array(3).fill('scaleX(1)'),
    )
    expect(fills[4]?.style.transform).toBe('scaleX(0)')

    await view.act(async () =>
      four.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })),
    )
    expect(view.current()).toBe('Three')
    expect(fills[3]?.style.transform).toBe('scaleX(0)')
    expect(document.querySelectorAll('.film-chapter[tabindex="0"]')).toHaveLength(1)
  } finally {
    await view.close()
  }
})
