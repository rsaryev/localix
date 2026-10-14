import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { useImagePan } from './useImagePan'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

async function mountPan() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act } = React
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let clicks = 0
  function Harness({ enabled = true }: { enabled?: boolean }) {
    const { isPanning, wasPanned, ...handlers } = useImagePan(enabled)
    return (
      <div {...handlers} data-panning={isPanning}>
        <button
          type="button"
          aria-label="Zoom preview"
          onClick={(event) => {
            if (event.detail === 0 || !wasPanned()) clicks += 1
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.currentTarget.click()
          }}
        >
          <img alt="Preview" />
        </button>
      </div>
    )
  }
  await act(async () => root.render(<Harness />))
  const element = host.firstElementChild as HTMLDivElement
  const captured = new Set<number>()
  element.setPointerCapture = (id) => captured.add(id)
  element.hasPointerCapture = (id) => captured.has(id)
  element.releasePointerCapture = (id) => {
    expect(captured.has(id)).toBe(true)
    captured.delete(id)
  }
  Object.defineProperties(element, {
    scrollWidth: { value: 1000 },
    scrollHeight: { value: 1000 },
    clientWidth: { value: 100 },
    clientHeight: { value: 100 },
  })
  element.scrollLeft = 100
  element.scrollTop = 100
  const pointer = async (
    type: string,
    pointerId = 1,
    init: PointerEventInit = {},
    target: EventTarget = element,
  ) => {
    await act(async () => {
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: 20,
          clientY: 20,
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      )
    })
  }
  const click = async (detail = 1) => {
    await act(async () =>
      element
        .querySelector('img')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, detail })),
    )
  }
  return {
    element,
    captured,
    pointer,
    click,
    press: async (key: string) => {
      await act(async () =>
        element
          .querySelector('img')!
          .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
      )
    },
    clicks: () => clicks,
    blur: async () => act(async () => window.dispatchEvent(new Event('blur'))),
    disable: async () => act(async () => root.render(<Harness enabled={false} />)),
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('image pan pointer ownership', () => {
  test('preserves an image click until movement crosses the drag threshold', async () => {
    const pan = await mountPan()
    try {
      await pan.pointer('pointerdown')
      await pan.pointer('pointermove', 1, { clientX: 22, clientY: 21 })
      expect(pan.captured.size).toBe(0)
      expect(pan.element.scrollLeft).toBe(100)
      await pan.pointer('pointerup')
      await pan.click()
      expect(pan.clicks()).toBe(1)
      expect(pan.element.dataset.panning).toBe('false')
    } finally {
      await pan.unmount()
    }
  })

  test('ignores other pointers and suppresses only the trailing click of the owner pan', async () => {
    const pan = await mountPan()
    try {
      await pan.pointer('pointerdown')
      await pan.pointer('pointerdown', 2)
      await pan.pointer('pointermove', 2, { clientX: 80 })
      await pan.pointer('pointerup', 2)
      expect(pan.element.scrollLeft).toBe(100)
      await pan.pointer('pointermove', 1, { clientX: 40, clientY: 30 }, window)
      expect(pan.captured.has(1)).toBe(true)
      expect(pan.element.dataset.panning).toBe('true')
      await pan.pointer('lostpointercapture', 2)
      expect(pan.element.dataset.panning).toBe('true')
      await pan.pointer('pointerup', 1, {}, window)
      expect(pan.element.scrollLeft).toBe(80)
      expect(pan.element.scrollTop).toBe(90)
      expect(pan.captured.size).toBe(0)
      await pan.click()
      expect(pan.clicks()).toBe(0)
      await pan.click(0)
      expect(pan.clicks()).toBe(1)
      await pan.press('Enter')
      await pan.press(' ')
      expect(pan.clicks()).toBe(3)
      await pan.pointer('pointerdown')
      await pan.pointer('pointerup')
      await pan.click()
      expect(pan.clicks()).toBe(4)
    } finally {
      await pan.unmount()
    }
  })

  test.each(['pointercancel', 'lostpointercapture', 'blur', 'disable', 'unmount'] as const)(
    'releases a cancelled pan on %s and stops handling later moves',
    async (reason) => {
      const pan = await mountPan()
      let unmounted = false
      try {
        await pan.pointer('pointerdown')
        await pan.pointer('pointermove', 1, { clientX: 40 })
        expect(pan.captured.size).toBe(1)
        if (reason === 'unmount') {
          await pan.unmount()
          unmounted = true
        } else if (reason === 'blur') await pan.blur()
        else if (reason === 'disable') await pan.disable()
        else await pan.pointer(reason)
        expect(pan.captured.size).toBe(0)
        const scroll = pan.element.scrollLeft
        await pan.pointer('pointermove', 1, { clientX: 70 }, window)
        await pan.pointer('pointerup', 1, {}, window)
        expect(pan.element.scrollLeft).toBe(scroll)
        if (!unmounted) expect(pan.element.dataset.panning).toBe('false')
      } finally {
        if (!unmounted) await pan.unmount()
      }
    },
  )

  test('rejects secondary and non-primary gestures', async () => {
    const pan = await mountPan()
    try {
      for (const init of [{ button: 2 }, { isPrimary: false }]) {
        await pan.pointer('pointerdown', 1, init)
        await pan.pointer('pointermove', 1, { clientX: 60 })
        await pan.pointer('pointerup')
      }
      expect(pan.captured.size).toBe(0)
      expect(pan.element.scrollLeft).toBe(100)
    } finally {
      await pan.unmount()
    }
  })

  test('a refused capture cancels the pan and suppresses its unintended image click', async () => {
    const pan = await mountPan()
    try {
      pan.element.setPointerCapture = () => {
        throw new DOMException('Pointer no longer active', 'NotFoundError')
      }
      await pan.pointer('pointerdown')
      await pan.pointer('pointermove', 1, { clientX: 60 })
      await pan.pointer('pointerup')
      expect(pan.element.scrollLeft).toBe(100)
      expect(pan.element.dataset.panning).toBe('false')
      await pan.click()
      expect(pan.clicks()).toBe(0)
    } finally {
      await pan.unmount()
    }
  })
})
