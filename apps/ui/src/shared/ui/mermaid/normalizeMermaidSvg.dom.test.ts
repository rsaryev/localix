import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { normalizeMermaidSvg } from './normalizeMermaidSvg'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(() => teardown())
const vector =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-49 -28 310 64" style="max-width:310px"><g class="root"><text>Last node</text></g></svg>'
test('a finished flowchart uses its actual positioned bounds, retaining content and cleaning up measurement DOM', () => {
  const prototype = Object.getPrototypeOf(
    document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
  )
  const previous = Object.getOwnPropertyDescriptor(prototype, 'getBBox')
  Object.defineProperty(prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 8, y: 8, width: 328, height: 40 }),
  })
  const count = document.body.children.length
  try {
    const output = normalizeMermaidSvg(vector)
    expect(output).toContain('viewBox="0 0 344 56"')
    expect(output).toContain('max-width: 344px')
    expect(output).toContain('Last node')
    expect(document.body.children.length).toBe(count)
  } finally {
    if (previous) Object.defineProperty(prototype, 'getBBox', previous)
    else Reflect.deleteProperty(prototype, 'getBBox')
  }
})
test('unsupported browser measurements keep the engine output and leave no hidden nodes behind', () => {
  const prototype = Object.getPrototypeOf(
    document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
  )
  const previous = Object.getOwnPropertyDescriptor(prototype, 'getBBox')
  Object.defineProperty(prototype, 'getBBox', {
    configurable: true,
    value: () => {
      throw new Error('no geometry')
    },
  })
  const count = document.body.children.length
  try {
    expect(normalizeMermaidSvg(vector)).toBe(vector)
    expect(document.body.children.length).toBe(count)
    expect(normalizeMermaidSvg('<svg><text>Other grammar</text></svg>')).toBe(
      '<svg><text>Other grammar</text></svg>',
    )
  } finally {
    if (previous) Object.defineProperty(prototype, 'getBBox', previous)
    else Reflect.deleteProperty(prototype, 'getBBox')
  }
})
