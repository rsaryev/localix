import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { MessageAttachment, MessageBinding } from '@/shared/api/contracts'
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

const image = (name: string): MessageAttachment => ({
  kind: 'image',
  mediaType: 'image/png',
  data: 'iVBORw0KGgo=',
  name,
  size: name.length,
})

test("a message's lightbox pages through its images in order, past the other attachments", async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MessageAttachments } = await import('./MessageAttachments')
  const bindings = [
    image('first.png'),
    { kind: 'text', name: 'notes.txt', size: 3, text: 'abc' },
    image('second.png'),
  ] as MessageBinding[]
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<MessageAttachments bindings={bindings} />))
  const { current, press } = lightboxPaging(act)

  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Open first.png full size"]')!.click(),
  )
  expect(current()).toBe('first.png')
  await press('ArrowLeft')
  expect(current()).toBe('first.png')
  await press('ArrowRight')
  expect(current()).toBe('second.png')
  await press('ArrowRight')
  expect(current()).toBe('second.png')
  await press('Escape')
  expect(current()).toBeNull()

  await act(async () => root.unmount())
  host.remove()
})
