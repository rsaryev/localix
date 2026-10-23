import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { setCompactDragImage, setElementDragImage, setNativeWindowDragImage } from './drag-image'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())

test('the visual ghost keeps the source footprint and grabbed point without any tab/drop identity', async () => {
  const source = document.createElement('div')
  source.id = 'real-tab'
  source.setAttribute('role', 'tab')
  source.dataset.workspaceTab = 'chat:1'
  source.draggable = true
  source.innerHTML = '<span id="tab-title" data-drop-target="true">Conversation</span>'
  source.getBoundingClientRect = () => ({ left: 200, top: 80, width: 180, height: 28 }) as DOMRect
  document.body.append(source)
  let ghost!: HTMLElement
  let point!: [number, number]
  const transfer = {
    setDragImage(element: HTMLElement, x: number, y: number) {
      ghost = element
      point = [x, y]
    },
  } as DataTransfer
  setElementDragImage(transfer, source, { clientX: 260, clientY: 91 })
  expect(point).toEqual([60, 11])
  expect(ghost.style.width).toBe('180px')
  expect(ghost.style.height).toBe('28px')
  expect(ghost.style.opacity).toBe('1')
  expect(ghost.inert).toBe(true)
  expect(ghost.getAttribute('aria-hidden')).toBe('true')
  expect(ghost.id).toBe('')
  expect(ghost.hasAttribute('draggable')).toBe(false)
  expect(ghost.querySelector('[id], [role], [data-drop-target]')).toBeNull()
  expect(document.getElementById('real-tab')).toBe(source)
  await new Promise((resolve) => setTimeout(resolve, 1))
  expect(ghost.isConnected).toBe(false)
  source.remove()
})

test('a hidden source leaves its existing compact fallback alone', () => {
  const source = document.createElement('div')
  let captures = 0
  const transfer = {
    setDragImage() {
      captures++
    },
  } as unknown as DataTransfer
  setElementDragImage(transfer, source, { clientX: 0, clientY: 0 })
  expect(captures).toBe(0)
})

test('a native window replaces the tab ghost and later strip helpers cannot duplicate it', async () => {
  const images: HTMLElement[] = []
  const transfer = {
    setDragImage(element: HTMLElement) {
      images.push(element)
    },
  } as unknown as DataTransfer
  const source = document.createElement('div')
  source.getBoundingClientRect = () => ({ left: 0, top: 0, width: 180, height: 28 }) as DOMRect
  setCompactDragImage(transfer, 'Chat')
  setNativeWindowDragImage(transfer)
  setElementDragImage(transfer, source, { clientX: 10, clientY: 10 })
  setCompactDragImage(transfer, 'Chat')
  expect(images).toHaveLength(2)
  const image = images[1] as HTMLCanvasElement
  expect(image.tagName).toBe('CANVAS')
  expect(image.width).toBe(1)
  expect(image.height).toBe(1)
  await new Promise((resolve) => setTimeout(resolve, 1))
  expect(image.isConnected).toBe(false)
  const nextGesture = {
    setDragImage(element: HTMLElement) {
      images.push(element)
    },
  } as unknown as DataTransfer
  setElementDragImage(nextGesture, source, { clientX: 10, clientY: 10 })
  expect(images).toHaveLength(3)
})
