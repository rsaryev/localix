import { describe, expect, test } from 'bun:test'
import { createMermaidRenderer, type MermaidEngine } from '@localixai/markdown/renderMermaid'
import type { MermaidLook } from '@localixai/markdown/mermaidLook'

// Two looks as `resolveMermaidLook` would produce them: the key is what the cache trusts.
const DARK: MermaidLook = { key: 'dark-palette', config: { theme: 'base', palette: 'dark' } }
const LIGHT: MermaidLook = { key: 'light-palette', config: { theme: 'base', palette: 'light' } }

/** A stand-in engine that records call order and lets a test hold a render open. */
function stubEngine() {
  const events: string[] = []
  let palette = ''
  const gates: Array<() => void> = []
  const engine: MermaidEngine = {
    initialize(config) {
      palette = String(config.palette)
      events.push(`init:${palette}`)
      expect(config.securityLevel).toBe('strict')
      expect(config.theme).toBe('base')
    },
    async parse(text) {
      if (text.includes('broken')) throw new Error('Parse error on line 1')
    },
    async render(id, text) {
      events.push(`start:${text}`)
      await new Promise<void>((resolve) => gates.push(resolve))
      events.push(`end:${text}`)
      return { svg: `<svg data-palette="${palette}" id="${id}">${text}</svg>` }
    },
  }
  // Waits for the next render to reach its gate, bounded: a render that never starts must fail
  // this test by name, not hang the run.
  const release = async () => {
    for (let tick = 0; gates.length === 0; tick += 1) {
      if (tick > 1_000) throw new Error('release: no Mermaid render reached its gate')
      await Promise.resolve()
    }
    gates.shift()?.()
  }
  return { engine, events, release }
}

describe('createMermaidRenderer', () => {
  test('runs one render at a time, so a second diagram cannot take the first one’s colours', async () => {
    const { engine, events, release } = stubEngine()
    const renderer = createMermaidRenderer(async () => engine)
    const first = renderer.render('A', DARK)
    const second = renderer.render('B', LIGHT)
    await release()
    expect(await first).toContain('data-palette="dark"')
    await release()
    expect(await second).toContain('data-palette="light"')
    expect(events).toEqual(['init:dark', 'start:A', 'end:A', 'init:light', 'start:B', 'end:B'])
  })

  test('caches by source AND look', async () => {
    const { engine, events, release } = stubEngine()
    const renderer = createMermaidRenderer(async () => engine)
    const drawn = renderer.render('A', DARK)
    await release()
    await drawn
    expect(renderer.peek('A', DARK)).toContain('A')
    expect(renderer.peek('A', LIGHT)).toBeUndefined()
    expect(await renderer.render('A', DARK)).toBe(await drawn)
    expect(events.filter((event) => event.startsWith('start'))).toHaveLength(1)
  })

  test('a diagram that does not parse rejects without blocking the next one', async () => {
    const { engine, release } = stubEngine()
    const renderer = createMermaidRenderer(async () => engine)
    const broken = renderer.render('broken', DARK)
    const next = renderer.render('A', DARK)
    await expect(broken).rejects.toThrow('Parse error')
    await release()
    expect(await next).toContain('A')
    expect(renderer.peek('broken', DARK)).toBeUndefined()
  })

  test('loads the engine once', async () => {
    const { engine, release } = stubEngine()
    let loads = 0
    const renderer = createMermaidRenderer(async () => {
      loads += 1
      return engine
    })
    const a = renderer.render('A', DARK)
    const b = renderer.render('B', DARK)
    await release()
    await release()
    await Promise.all([a, b])
    expect(loads).toBe(1)
  })

  test('shares an identical in-flight layout between remounted rows', async () => {
    const { engine, events, release } = stubEngine()
    const renderer = createMermaidRenderer(async () => engine)
    const first = renderer.render('A', DARK)
    const second = renderer.render('A', DARK)
    await release()
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(events.filter((event) => event.startsWith('start'))).toEqual(['start:A'])
  })

  test('drops an abandoned queued diagram before layout and lets it be requested again', async () => {
    const { engine, events, release } = stubEngine()
    const renderer = createMermaidRenderer(async () => engine)
    const first = renderer.render('A', DARK)
    const controller = new AbortController()
    const abandoned = renderer.render('B', DARK, controller.signal)
    void abandoned.catch(() => undefined)
    controller.abort()
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    const next = renderer.render('C', DARK)
    await release()
    await first
    await release()
    await next
    expect(events.filter((event) => event.startsWith('start'))).toEqual(['start:A', 'start:C'])
    expect(renderer.peek('B', DARK)).toBeUndefined()
    const retried = renderer.render('B', DARK)
    await release()
    expect(await retried).toContain('B')
  })

  test('one caller leaving never cancels another caller of the same diagram', async () => {
    const { engine, release } = stubEngine()
    const renderer = createMermaidRenderer(async () => engine)
    const controller = new AbortController()
    const leaving = renderer.render('A', DARK, controller.signal)
    const staying = renderer.render('A', DARK)
    void leaving.catch(() => undefined)
    controller.abort()
    await expect(leaving).rejects.toMatchObject({ name: 'AbortError' })
    await release()
    expect(await staying).toContain('A')
    expect(renderer.peek('A', DARK)).toBe(await staying)
  })

  test('an abandoned active layout does not fill the cache and cannot block the next diagram', async () => {
    const { engine, release } = stubEngine()
    const renderer = createMermaidRenderer(async () => engine)
    const controller = new AbortController()
    const abandoned = renderer.render('A', DARK, controller.signal)
    // Wait until A is drawing before leaving: its engine cannot interrupt a layout in progress.
    await release()
    void abandoned.catch(() => undefined)
    controller.abort()
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    const next = renderer.render('B', DARK)
    await release()
    expect(await next).toContain('B')
    expect(renderer.peek('A', DARK)).toBeUndefined()
  })

  test('an already aborted request never loads the engine', async () => {
    let loads = 0
    const renderer = createMermaidRenderer(async () => {
      loads += 1
      return stubEngine().engine
    })
    const controller = new AbortController()
    controller.abort()
    await expect(renderer.render('A', DARK, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(loads).toBe(0)
  })
})
