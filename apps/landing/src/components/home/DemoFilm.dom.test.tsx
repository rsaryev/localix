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

test('the demo waits on its poster, loads on request, and plays without player chrome', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { DemoFilm } = await import('./DemoFilm')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<DemoFilm />))
  try {
    const video = host.querySelector('video')!
    expect(video.getAttribute('src')).toBeNull()
    expect(video.getAttribute('poster')).toBe('/films/demo.jpg')
    expect(video.hasAttribute('controls')).toBe(false)
    expect(host.querySelector('.demo-cover')?.textContent).toBe('Watch the demo')

    const toggle = host.querySelector<HTMLButtonElement>('.demo-toggle')!
    expect(toggle.getAttribute('aria-label')).toBe('Play demo')
    await act(async () => toggle.click())

    expect(video.getAttribute('src')).toBe('/films/demo.mp4')
    expect(video.hasAttribute('controls')).toBe(false)
    expect(video.loop).toBe(true)
    expect(host.querySelector('.demo-cover')?.textContent).toBe('Resume')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
