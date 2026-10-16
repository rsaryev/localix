import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

describe('screenshot backdrop', () => {
  test('inherits the nearest painted ancestor and allows an explicit override', async () => {
    const { includeInRaster, resolveRasterBackdrop } = await import('./index')
    const parent = document.createElement('div')
    const child = document.createElement('button')
    parent.style.backgroundColor = 'rgb(12, 18, 30)'
    parent.append(child)
    document.body.append(parent)
    expect(resolveRasterBackdrop(child)).toBe('rgb(12, 18, 30)')
    expect(resolveRasterBackdrop(child, '#123456')).toBe('#123456')
    expect(includeInRaster(child)).toBe(true)
    child.setAttribute('data-vf-ignore', '')
    expect(includeInRaster(child)).toBe(false)
  })

  test('uses the opaque layer beneath a translucent element', async () => {
    const { resolveRasterBackdrop } = await import('./index')
    const parent = document.createElement('div')
    const child = document.createElement('div')
    parent.style.backgroundColor = 'rgb(24, 32, 48)'
    child.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'
    parent.append(child)
    document.body.append(parent)
    expect(resolveRasterBackdrop(child)).toBe('rgb(24, 32, 48)')
  })
})
