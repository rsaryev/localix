import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

async function open(image: { src: string; name: string; kind?: 'image' | 'video' } | null) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { ImageLightbox } = await import('./image-lightbox')

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<ImageLightbox image={image} onClose={() => {}} />))
  // The dialog portals out of `host`, so query the document.
  const buttons = [...document.querySelectorAll('button')]
  const links = [...document.querySelectorAll('a')]
  return {
    copy: buttons.find((b) => b.textContent?.includes('Copy')) ?? null,
    download: links.find((a) => a.textContent?.includes('Download')) ?? null,
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('ImageLightbox', () => {
  // An image the USER attached had a lightbox and a download link but no copy,
  // while a model-generated image beside it had one. With no copy affordance the
  // only way to copy the picture is to select it and press ⌘C — and for an inline
  // attachment that puts the `<img>`'s `data:image/png;base64,…` src on the
  // clipboard as TEXT, which is how a pasted screenshot arrived as a wall of
  // base64 instead of an image.
  test('offers copy alongside download for an image', async () => {
    const { copy, download, cleanup } = await open({
      src: 'data:image/png;base64,iVBORw0KGgo=',
      name: 'Screenshot.png',
    })
    try {
      expect(copy).not.toBeNull()
      expect(download).not.toBeNull()
      expect(download?.getAttribute('download')).toBe('Screenshot.png')
    } finally {
      await cleanup()
    }
  })

  test('offers only download for a video, which has no clipboard equivalent', async () => {
    const { copy, download, cleanup } = await open({
      src: 'blob:video',
      name: 'clip.mp4',
      kind: 'video',
    })
    try {
      expect(copy).toBeNull()
      expect(download).not.toBeNull()
    } finally {
      await cleanup()
    }
  })

  test('renders nothing when closed', async () => {
    const { copy, download, cleanup } = await open(null)
    try {
      expect(copy).toBeNull()
      expect(download).toBeNull()
    } finally {
      await cleanup()
    }
  })
})

describe('useLightboxPaging', () => {
  test('opens one image, pages within the list and closes', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { useLightboxPaging } = await import('./image-lightbox')
    const images = [
      { src: 'blob:a', name: 'a.png' },
      { src: 'blob:b', name: 'b.png' },
    ]
    let paging!: ReturnType<typeof useLightboxPaging<(typeof images)[number]>>
    function Harness() {
      paging = useLightboxPaging(images)
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Harness />))
    expect(paging.lightbox.image).toBeNull()
    expect(paging.lightbox).toMatchObject({ hasPrev: false, hasNext: false })

    await act(async () => paging.open(0))
    expect(paging.lightbox.image?.name).toBe('a.png')
    expect(paging.lightbox).toMatchObject({ hasPrev: false, hasNext: true, onPrev: undefined })
    await act(async () => paging.lightbox.onNext?.())
    expect(paging.lightbox.image?.name).toBe('b.png')
    expect(paging.lightbox).toMatchObject({ hasPrev: true, hasNext: false, onNext: undefined })
    await act(async () => paging.lightbox.onPrev?.())
    expect(paging.lightbox.image?.name).toBe('a.png')
    await act(async () => paging.lightbox.onClose())
    expect(paging.lightbox.image).toBeNull()
    await act(async () => root.unmount())
  })
})
