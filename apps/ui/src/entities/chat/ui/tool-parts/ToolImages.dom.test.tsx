import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ToolBackedItem } from '@localixai/agent/agents'
import { lightboxPaging } from '@/testing/lightboxPaging'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test("a tool's returned images page in the lightbox, stopping at both ends", async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ToolImages } = await import('./ToolImages')
  const attachments = ['a.png', 'b.png'].map((name, index) => ({
    kind: 'image',
    mediaType: 'image/png',
    data: `iVBORw0KGgo${index}`,
    name,
    size: 1,
  }))
  const item = { attachments } as unknown as ToolBackedItem
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<ToolImages item={item} />))
  const { current, press } = lightboxPaging(act)

  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  expect(current()).toBe('a.png')
  await press('ArrowLeft')
  expect(current()).toBe('a.png')
  await press('ArrowRight')
  expect(current()).toBe('b.png')
  await press('ArrowRight')
  expect(current()).toBe('b.png')
  await press('Escape')
  expect(current()).toBeNull()

  await act(async () => root.unmount())
  host.remove()
})
