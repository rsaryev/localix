import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { PendingAttachment } from '@/shared/lib/attachment-policy'
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

const image = (id: string): PendingAttachment => ({
  id,
  attachment: { kind: 'image', mediaType: 'image/png', data: id, name: `${id}.png`, size: 1 },
  previewUrl: `blob:${id}`,
})

test('the tray lightbox pages through the staged images only, stopping at both ends', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { AttachmentTray } = await import('./AttachmentTray')
  const attachments: PendingAttachment[] = [
    image('one'),
    {
      id: 'notes',
      attachment: { kind: 'text', name: 'notes.txt', size: 3, text: 'abc' },
    },
    image('two'),
  ]
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(<AttachmentTray attachments={attachments} onRemove={() => {}} />),
  )
  const { current, press } = lightboxPaging(act)
  expect(current()).toBeNull()

  await act(async () => host.querySelector<HTMLButtonElement>('[title="View two.png"]')!.click())
  expect(current()).toBe('two.png')
  await press('ArrowRight')
  expect(current()).toBe('two.png')
  await press('ArrowLeft')
  expect(current()).toBe('one.png')
  await press('ArrowLeft')
  expect(current()).toBe('one.png')
  await press('ArrowRight')
  expect(current()).toBe('two.png')
  await press('Escape')
  expect(current()).toBeNull()

  await act(async () => root.unmount())
  host.remove()
})
