import { expect, test } from 'bun:test'
import {
  clampOpenHeight,
  isIslandGeometry,
  ISLAND,
  islandStyle,
  PREVIEW_GEOMETRY,
} from './geometry'

test('open height adds the notch band and stays inside the fixed canvas', () => {
  expect(clampOpenHeight(100.2, 32)).toBe(133)
  expect(clampOpenHeight(0, 0)).toBe(ISLAND.openMinHeight)
  expect(clampOpenHeight(900, 32)).toBe(ISLAND.canvasHeight)
})

test('only a complete numeric geometry from the host replaces the fallback', () => {
  expect(isIslandGeometry(PREVIEW_GEOMETRY)).toBe(true)
  expect(isIslandGeometry({ ...PREVIEW_GEOMETRY, nativePanel: true })).toBe(true)
  expect(isIslandGeometry({ compactWidth: 48, compactHeight: 36, notchWidth: 0 })).toBe(false)
  expect(isIslandGeometry({ ...PREVIEW_GEOMETRY, notchHeight: Number.NaN })).toBe(false)
  expect(isIslandGeometry(null)).toBe(false)
})

test('CSS receives every island size from one place', () => {
  expect(islandStyle(PREVIEW_GEOMETRY, 128) as Record<string, string>).toEqual({
    '--island-canvas-width': '720px',
    '--island-canvas-height': '680px',
    '--island-open-width': '580px',
    '--island-open-height': '128px',
    '--island-compact-width': '48px',
    '--island-compact-height': '36px',
    '--island-notch-width': '0px',
    '--island-notch-height': '0px',
  })
})

test('the open island has one width inside the fixed canvas', () => {
  const style = islandStyle(PREVIEW_GEOMETRY, 128) as Record<string, string>
  expect(style['--island-open-width']).toBe(`${ISLAND.openWidth}px`)
  expect(style['--island-canvas-width']).toBe('720px')
})
