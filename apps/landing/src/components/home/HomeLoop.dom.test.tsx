import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

async function render() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { HomeLoop } = await import('./HomeLoop')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MemoryRouter>
        <HomeLoop />
      </MemoryRouter>,
    ),
  )
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

test('the loop is one titled section of cards, each with its words and a real capture of the app', async () => {
  const { host, cleanup } = await render()
  const section = host.querySelector('section')!
  const title = section.querySelector('h2')!
  expect(section.getAttribute('aria-labelledby')).toBe(title.id)
  const cards = [...section.querySelectorAll('article')]
  expect(cards.length).toBe(5)
  let withCapture = 0
  for (const card of cards) {
    expect(card.querySelector('h3')?.textContent).toBeTruthy()
    expect(card.querySelector('p')?.textContent).toBeTruthy()
    // Every card has exactly one capture, and it says what it shows; nothing is drawn.
    const shots = card.querySelectorAll('button img')
    expect(shots.length).toBe(1)
    expect(card.querySelector('[role="img"]')).toBeNull()
    for (const img of shots) {
      expect(img.getAttribute('alt')?.length).toBeGreaterThan(10)
      // The homepage's own capture, whole: one 16:10 picture per card, the same size for all.
      expect(img.getAttribute('src')).toMatch(/^\/landing\/[a-z-]+\.webp$/)
      expect([img.getAttribute('width'), img.getAttribute('height')]).toEqual(['1600', '1000'])
    }
    withCapture += shots.length
  }
  expect(withCapture).toBe(cards.length)
  const sources = cards.map((card) => card.querySelector('img')!.getAttribute('src'))
  expect(new Set(sources).size).toBe(cards.length)
  await cleanup()
})

test('a capture opens larger on a click and closes with Escape or the close button', async () => {
  const { act } = await import('react')
  const { host, cleanup } = await render()
  const opener = host.querySelector<HTMLButtonElement>('article button.shot-open')!
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => opener.click())
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(dialog.querySelector('img')?.getAttribute('alt')).toBe(dialog.getAttribute('aria-label'))
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => opener.click())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await cleanup()
})

function cardNamed(host: HTMLElement, title: RegExp) {
  const card = [...host.querySelectorAll('article')].find((a) =>
    title.test(a.querySelector('h3')!.textContent!),
  )
  expect(card).toBeDefined()
  return card!
}

test('the Store card names what the Store offers, and links to its page', async () => {
  const { host, cleanup } = await render()
  const card = cardNamed(host, /Store/)
  const words = card.querySelector('p')!.textContent!
  for (const kind of ['mini apps', 'plugins', 'skills', 'agents', 'MCP servers'])
    expect(words).toContain(kind)
  // Claude Code's plugins load as they are: that sits with the Store, not on a card of its own.
  expect(words).toContain('Claude Code')
  const links = [...card.querySelectorAll('a')].map((a) => a.getAttribute('href'))
  expect(links).toEqual(['/docs/features--store', '/docs/extending--claude-code-plugins'])
  await cleanup()
})

test('one mini apps card covers what a person gets, what a developer builds on and the Mac app', async () => {
  const { host, cleanup } = await render()
  const cards = [...host.querySelectorAll('article')]
  expect(cards.filter((c) => /mini app/i.test(c.querySelector('h3')!.textContent!)).length).toBe(1)
  const card = cardNamed(host, /Mini apps/)
  const words = card.querySelector('p')!.textContent!
  for (const part of [
    'tools',
    'decision models',
    'embeddings',
    'Localix marketplace',
    'Dock',
    'Spotlight',
  ])
    expect(words).toContain(part)
  const links = [...card.querySelectorAll('a')].map((a) => a.getAttribute('href'))
  expect(links).toEqual([
    '/docs/features--mini-apps',
    '/docs/extending--mini-apps',
    '/docs/features--mini-app-mac-apps',
    'https://github.com/rsaryev/localix-marketplace',
  ])
  expect(words).not.toMatch(/\/[a-z-]+:[a-z-]+/)
  await cleanup()
})

test('decision models share the models card, with their fallback and their own page', async () => {
  const { host, cleanup } = await render()
  expect(host.textContent).not.toContain('Decision models for the quick choices')
  const card = cardNamed(host, /Any model/)
  expect(card.querySelector('p')!.textContent).toContain('fallback')
  const links = [...card.querySelectorAll('a')].map((a) => a.getAttribute('href'))
  expect(links).toContain('/docs/features--decision-models')
  expect(links).toContain('/docs/features--local-models')
  await cleanup()
})

test('card copy stays calm: no promises, no speed or duration nobody measured', async () => {
  const { host, cleanup } = await render()
  const copy = [...host.querySelectorAll('.loop-text')].map((t) => t.textContent).join(' ')
  expect(copy).not.toMatch(
    /\b(?:revolutionary|seamless\w*|blazing|powerful|game-changing|effortless\w*|supercharge|unlock|unleash|cutting-edge|world-class)\b/i,
  )
  expect(copy).not.toMatch(
    /\b(?:in seconds|within seconds|instantly|instant|in minutes|faster|fastest|lightning|real[- ]time)\b/i,
  )
  await cleanup()
})

test('every card that links to the docs opens a page that exists', async () => {
  const { docPages } = await import('../../generated/docs')
  const slugs = new Set(docPages.map((page) => page.slug))
  const { host, cleanup } = await render()
  const links = [...host.querySelectorAll<HTMLAnchorElement>('article a')].filter((a) =>
    a.getAttribute('href')!.startsWith('/'),
  )
  expect(links.length).toBeGreaterThanOrEqual(5)
  for (const link of links) {
    const slug = new URL(link.href, 'https://localix.ai').pathname.replace('/docs/', '')
    expect(slugs.has(slug)).toBe(true)
  }
  await cleanup()
})
